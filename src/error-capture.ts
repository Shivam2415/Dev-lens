type CapturedRuntimeError = {
  message: string;
  timestamp: string;
  kind: "runtime" | "console" | "promise";
  source?: string;
  page?: string;
  line?: number;
  column?: number;
};

type IsolatedCaptureState = {
  startedAt: string;
  errors: CapturedRuntimeError[];
};

declare global {
  interface Window {
    __devLensIsolatedErrors?: IsolatedCaptureState;
    __devLensIsolatedCaptureInstalled?: boolean;
    __devLensStopIsolatedCapture?: () => {
      world: "isolated";
      origin: string;
      url: string;
      title: string;
      startedAt: string;
      errors: CapturedRuntimeError[];
    } | undefined;
  }
}

if (!window.__devLensIsolatedCaptureInstalled) {
  window.__devLensIsolatedCaptureInstalled = true;
  const state: IsolatedCaptureState = {
    startedAt: new Date().toISOString(),
    errors: []
  };
  window.__devLensIsolatedErrors = state;

  let active = true;
  const addError = (error: CapturedRuntimeError) => {
    if (!active) return;
    state.errors.push(error);
    state.errors = state.errors.slice(-100);
    publishSnapshot();
  };
  const publishSnapshot = () => {
    if (!active) return;
    window.postMessage(
      {
        source: "devlens",
        type: "capture-snapshot",
        snapshot: {
          world: "isolated",
          origin: window.location.origin,
          url: `${window.location.origin}${window.location.pathname}`,
          title: document.title,
          startedAt: state.startedAt,
          errors: state.errors
        }
      },
      window.location.origin
    );
  };
  const safeUrl = (value: string) => {
    try {
      const url = new URL(value, window.location.href);
      return `${url.origin}${url.pathname}`;
    } catch {
      return value.slice(0, 300);
    }
  };

  const abortController = new AbortController();
  const onError = (event: ErrorEvent) => {
    if (!event.message) return;
    addError({
      message: event.message.slice(0, 500),
      timestamp: new Date().toISOString(),
      kind: "runtime",
      ...(event.filename ? { source: safeUrl(event.filename) } : {}),
      ...(event.lineno > 0 ? { line: event.lineno } : {}),
      ...(event.colno > 0 ? { column: event.colno } : {})
    });
  };
  window.addEventListener("error", onError, { capture: true, signal: abortController.signal });
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    addError({
      message: (reason instanceof Error ? reason.message : String(reason ?? "Unhandled promise rejection")).slice(
        0,
        500
      ),
      timestamp: new Date().toISOString(),
      kind: "promise"
    });
  };
  window.addEventListener("unhandledrejection", onUnhandledRejection, {
    capture: true,
    signal: abortController.signal
  });
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
  window.__devLensStopIsolatedCapture = () => {
    const snapshot = {
      world: "isolated" as const,
      origin: window.location.origin,
      url: `${window.location.origin}${window.location.pathname}`,
      title: document.title,
      startedAt: state.startedAt,
      errors: state.errors
    };
    active = false;
    abortController.abort();
    window.__devLensIsolatedCaptureInstalled = false;
    window.__devLensStopIsolatedCapture = undefined;
    return snapshot;
  };
}
