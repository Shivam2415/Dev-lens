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
    __devLensStopCapture?: () => {
      world: "main";
      origin: string;
      url: string;
      title: string;
      startedAt: string;
      errors: CapturedError[];
      requests: CapturedRequest[];
      lastInteraction?: ElementContext[];
    } | undefined;
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
  let active = true;
  const abortController = new AbortController();
  const originalConsoleErrorDescriptor = Object.getOwnPropertyDescriptor(console, "error");
  const originalFetchDescriptor = Object.getOwnPropertyDescriptor(window, "fetch");
  const originalOpenDescriptor = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, "open");
  const originalSendDescriptor = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, "send");
  const publishSnapshot = () => {
    if (!active) return;
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
    if (!active) return;
    state.errors.push({ message: message.slice(0, 500), timestamp: new Date().toISOString(), ...details });
    state.errors = state.errors.slice(-100);
    publishSnapshot();
  };
  const addRequest = (request: CapturedRequest) => {
    if (!active) return;
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
  const captureConsoleErrorGetter = () => captureConsoleError;
  Object.defineProperty(console, "error", {
    configurable: true,
    enumerable: true,
    get: captureConsoleErrorGetter,
    set: (value: typeof console.error) => {
      if (value !== captureConsoleError) pageConsoleError = value;
    }
  });

  const onError = (event: ErrorEvent) => {
    if (!event.message) return;
    addRuntimeError(
      event.message,
      event.filename ? safeUrl(event.filename) : undefined,
      event.lineno > 0 ? event.lineno : undefined,
      event.colno > 0 ? event.colno : undefined
    );
  };
  window.addEventListener("error", onError, { capture: true, signal: abortController.signal });
  const originalOnError = window.onerror;
  const captureOnError = function (
    this: Window,
    message: string | Event,
    source?: string,
    line?: number,
    column?: number,
    error?: Error
  ) {
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
  window.onerror = captureOnError;
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    addError(reason instanceof Error ? reason.message : String(reason ?? "Unhandled promise rejection"), {
      kind: "promise"
    });
  };
  window.addEventListener("unhandledrejection", onUnhandledRejection, {
    capture: true,
    signal: abortController.signal
  });
  const onClick = (event: MouseEvent) => {
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
  };
  window.addEventListener("click", onClick, { capture: true, signal: abortController.signal });

  const originalFetch = window.fetch;
  const captureFetch = function (this: Window, ...args: Parameters<typeof fetch>) {
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
  window.fetch = captureFetch;

  const xhrUrls = new WeakMap<XMLHttpRequest, { method: string; url: string }>();
  const originalOpen = XMLHttpRequest.prototype.open;
  const captureOpen = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: [async?: boolean, username?: string | null, password?: string | null]
  ) {
    xhrUrls.set(this, { method: method.toUpperCase(), url: safeUrl(url.toString()) });
    if (rest.length === 0) return originalOpen.call(this, method, url, true);
    return originalOpen.call(this, method, url, rest[0] ?? true, rest[1], rest[2]);
  };
  XMLHttpRequest.prototype.open = captureOpen;
  const originalSend = XMLHttpRequest.prototype.send;
  const captureSend = function (this: XMLHttpRequest, ...args: Parameters<XMLHttpRequest["send"]>) {
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
      { once: true, signal: abortController.signal }
    );
    return originalSend.apply(this, args);
  };
  XMLHttpRequest.prototype.send = captureSend;

  const onMessage = (event: MessageEvent<unknown>) => {
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
  };
  window.addEventListener("message", onMessage, { signal: abortController.signal });
  window.addEventListener("pagehide", publishSnapshot, { once: true, signal: abortController.signal });
  publishSnapshot();

  window.__devLensStopCapture = () => {
    const snapshot = {
      world: "main" as const,
      origin: window.location.origin,
      url: `${window.location.origin}${window.location.pathname}`,
      title: document.title,
      startedAt: state.startedAt,
      errors: state.errors,
      requests: state.requests,
      ...(state.lastInteraction ? { lastInteraction: state.lastInteraction } : {})
    };
    active = false;
    abortController.abort();
    if (window.onerror === captureOnError) window.onerror = originalOnError;
    if (Object.getOwnPropertyDescriptor(console, "error")?.get === captureConsoleErrorGetter) {
      if (originalConsoleErrorDescriptor) {
        Object.defineProperty(
          console,
          "error",
          "value" in originalConsoleErrorDescriptor
            ? { ...originalConsoleErrorDescriptor, value: pageConsoleError }
            : originalConsoleErrorDescriptor
        );
      } else {
        delete (console as { error?: typeof console.error }).error;
      }
    }
    if (window.fetch === captureFetch) {
      if (originalFetchDescriptor) Object.defineProperty(window, "fetch", originalFetchDescriptor);
      else window.fetch = originalFetch;
    }
    if (XMLHttpRequest.prototype.open === captureOpen) {
      if (originalOpenDescriptor) Object.defineProperty(XMLHttpRequest.prototype, "open", originalOpenDescriptor);
      else XMLHttpRequest.prototype.open = originalOpen;
    }
    if (XMLHttpRequest.prototype.send === captureSend) {
      if (originalSendDescriptor) Object.defineProperty(XMLHttpRequest.prototype, "send", originalSendDescriptor);
      else XMLHttpRequest.prototype.send = originalSend;
    }
    window.__devLensCaptureInstalled = false;
    window.__devLensStopCapture = undefined;
    return snapshot;
  };
}
