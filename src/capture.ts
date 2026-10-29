type CapturedError = {
  message: string;
  timestamp: string;
  kind: "runtime" | "console" | "promise";
  occurrences?: number;
  source?: string;
  page?: string;
  line?: number;
  column?: number;
};

type CapturedRequest = {
  method: string;
  url: string;
  status?: number;
  error?: string;
  timestamp: string;
};

type ElementContext = {
  tag: string;
  id?: string;
  role?: string;
  testId?: string;
  classes: string[];
};

type CaptureState = {
  startedAt: string;
  errors: CapturedError[];
  requests: CapturedRequest[];
  lastInteraction?: ElementContext[];
};

declare global {
  interface Window {
    __devLensCapture?: CaptureState;
    __devLensCaptureInstalled?: boolean;
  }
}

if (!window.__devLensCaptureInstalled) {
  window.__devLensCaptureInstalled = true;
  window.__devLensCapture = {
    startedAt: new Date().toISOString(),
    errors: [],
    requests: []
  };

  const state = window.__devLensCapture;
  const publishSnapshot = () => {
    window.postMessage(
      {
        source: "devlens",
        type: "capture-snapshot",
        snapshot: {
          world: "main",
          origin: window.location.origin,
          url: `${window.location.origin}${window.location.pathname}`,
          title: document.title,
          startedAt: state.startedAt,
          errors: state.errors,
          requests: state.requests,
          ...(state.lastInteraction ? { lastInteraction: state.lastInteraction } : {})
        }
      },
      window.location.origin
    );
  };
  const addError = (
    message: string,
    details: Omit<CapturedError, "message" | "timestamp"> = { kind: "runtime" }
  ) => {
    state.errors.push({ message: message.slice(0, 500), timestamp: new Date().toISOString(), ...details });
    state.errors = state.errors.slice(-100);
    publishSnapshot();
  };
  const addRequest = (request: CapturedRequest) => {
    state.requests.push(request);
    state.requests = state.requests.slice(-100);
    publishSnapshot();
  };
  const recentRuntimeErrors = new Map<string, number>();
  const addRuntimeError = (message: string, source?: string, line?: number, column?: number) => {
    const key = `${message}\n${source ?? ""}\n${line ?? ""}\n${column ?? ""}`;
    const now = Date.now();
    const previous = recentRuntimeErrors.get(key);
    if (previous !== undefined && now - previous < 10) return;
    recentRuntimeErrors.set(key, now);
    if (recentRuntimeErrors.size > 100) {
      const oldest = recentRuntimeErrors.keys().next().value;
      if (oldest !== undefined) recentRuntimeErrors.delete(oldest);
    }

    addError(message, {
      kind: "runtime",
      ...(source ? { source } : {}),
      ...(line ? { line } : {}),
      ...(column ? { column } : {})
    });
  };
  const safeUrl = (value: string) => {
    try {
      const url = new URL(value, window.location.href);
      return `${url.origin}${url.pathname}`;
    } catch {
      return value.slice(0, 300);
    }
  };

  let pageConsoleError = console.error;
  const captureConsoleError = function (...args: unknown[]) {
    const message = args
      .map((arg) => {
        if (typeof arg === "string") return arg;
        if (arg instanceof Error) return arg.message;
        if (typeof arg === "object" && arg !== null && "message" in arg && typeof arg.message === "string") {
          return arg.message;
        }
        if (typeof arg === "number" || typeof arg === "boolean") return String(arg);
        return "";
      })
      .filter(Boolean)
      .join(" ");
    if (message) {
      const existingError = state.errors.find((error) => error.kind === "console" && error.message === message);
      if (existingError) {
        existingError.occurrences = (existingError.occurrences ?? 1) + 1;
        publishSnapshot();
      } else {
        addError(message, { kind: "console" });
      }
    }
    pageConsoleError.apply(console, args);
  };
  Object.defineProperty(console, "error", {
    configurable: true,
    enumerable: true,
    get: () => captureConsoleError,
    set: (value: typeof console.error) => {
      if (value !== captureConsoleError) pageConsoleError = value;
    }
  });

  window.addEventListener(
    "error",
    (event: ErrorEvent) => {
      if (!event.message) return;
      addRuntimeError(
        event.message,
        event.filename ? safeUrl(event.filename) : undefined,
        event.lineno > 0 ? event.lineno : undefined,
        event.colno > 0 ? event.colno : undefined
      );
    },
    true
  );
  const originalOnError = window.onerror;
  window.onerror = function (message, source, line, column, error) {
    const errorMessage =
      typeof message === "string" ? message : error?.message || "Uncaught script error";
    addRuntimeError(
      errorMessage,
      source ? safeUrl(source) : undefined,
      typeof line === "number" && line > 0 ? line : undefined,
      typeof column === "number" && column > 0 ? column : undefined
    );
    if (typeof originalOnError === "function") {
      return originalOnError.call(this, message, source, line, column, error);
    }
    return false;
  };
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    addError(reason instanceof Error ? reason.message : String(reason ?? "Unhandled promise rejection"), {
      kind: "promise"
    });
  }, true);
  window.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const hierarchy: ElementContext[] = [];
      let element: Element | null = target;
      while (element && hierarchy.length < 5) {
        hierarchy.push({
          tag: element.tagName.toLowerCase(),
          ...(element.id ? { id: element.id.slice(0, 100) } : {}),
          ...(element.getAttribute("role") ? { role: element.getAttribute("role")!.slice(0, 50) } : {}),
          ...(element.getAttribute("data-testid")
            ? { testId: element.getAttribute("data-testid")!.slice(0, 100) }
            : {}),
          classes: Array.from(element.classList).slice(0, 5).map((name) => name.slice(0, 50))
        });
        element = element.parentElement;
      }
      state.lastInteraction = hierarchy;
      publishSnapshot();
    },
    true
  );

  const originalFetch = window.fetch;
  window.fetch = function (...args: Parameters<typeof fetch>) {
    const input = args[0];
    const request = input instanceof Request ? input : undefined;
    const url = safeUrl(typeof input === "string" ? input : request?.url ?? input.toString());
    const method = (args[1]?.method || request?.method || "GET").toUpperCase();
    return originalFetch.apply(this, args).then(
      (response) => {
        if (!response.ok) {
          addRequest({ method, url, status: response.status, timestamp: new Date().toISOString() });
        }
        return response;
      },
      (error: unknown) => {
        addRequest({
          method,
          url,
          error: error instanceof Error ? error.message.slice(0, 200) : "Network request failed",
          timestamp: new Date().toISOString()
        });
        throw error;
      }
    );
  };

  const xhrUrls = new WeakMap<XMLHttpRequest, { method: string; url: string }>();
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (
    method: string,
    url: string | URL,
    ...rest: [async?: boolean, username?: string | null, password?: string | null]
  ) {
    xhrUrls.set(this, { method: method.toUpperCase(), url: safeUrl(url.toString()) });
    if (rest.length === 0) return originalOpen.call(this, method, url, true);
    return originalOpen.call(this, method, url, rest[0] ?? true, rest[1], rest[2]);
  };
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args: Parameters<XMLHttpRequest["send"]>) {
    this.addEventListener(
      "loadend",
      () => {
        const request = xhrUrls.get(this);
        if (!request) return;
        if (this.status === 0 || this.status >= 400) {
          addRequest({
            ...request,
            ...(this.status ? { status: this.status } : { error: "Network request failed" }),
            timestamp: new Date().toISOString()
          });
        }
      },
      { once: true }
    );
    return originalSend.apply(this, args);
  };

  window.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (
      event.source === window &&
      event.origin === window.location.origin &&
      typeof event.data === "object" &&
      event.data !== null &&
      "source" in event.data &&
      event.data.source === "devlens-bridge" &&
      "type" in event.data &&
      event.data.type === "request-snapshot"
    ) {
      publishSnapshot();
    }
  });
  window.addEventListener("pagehide", publishSnapshot, { once: true });
  publishSnapshot();
}
