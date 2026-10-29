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
  }
}

if (!window.__devLensIsolatedErrors) {
  const state: IsolatedCaptureState = {
    startedAt: new Date().toISOString(),
    errors: []
  };
  window.__devLensIsolatedErrors = state;

  const addError = (error: CapturedRuntimeError) => {
    state.errors.push(error);
    state.errors = state.errors.slice(-100);
    publishSnapshot();
  };
  const publishSnapshot = () => {
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

  window.addEventListener(
    "error",
    (event: ErrorEvent) => {
      if (!event.message) return;
      addError({
        message: event.message.slice(0, 500),
        timestamp: new Date().toISOString(),
        kind: "runtime",
        ...(event.filename ? { source: safeUrl(event.filename) } : {}),
        ...(event.lineno > 0 ? { line: event.lineno } : {}),
        ...(event.colno > 0 ? { column: event.colno } : {})
      });
    },
    true
  );
  window.addEventListener(
    "unhandledrejection",
    (event) => {
      const reason = event.reason;
      addError({
        message: (reason instanceof Error ? reason.message : String(reason ?? "Unhandled promise rejection")).slice(
          0,
          500
        ),
        timestamp: new Date().toISOString(),
        kind: "promise"
      });
    },
    true
  );
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
