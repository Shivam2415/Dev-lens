type CaptureSnapshotMessage = {
  source: "devlens";
  type: "capture-snapshot";
  snapshot: {
    world: "main" | "isolated";
    origin: string;
    url: string;
    title: string;
    startedAt: string;
    errors: unknown[];
    requests?: unknown[];
    lastInteraction?: unknown[];
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCapturedError(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.message === "string" &&
    value.message.length <= 500 &&
    typeof value.timestamp === "string" &&
    value.timestamp.length <= 40 &&
    ["runtime", "console", "promise"].includes(String(value.kind)) &&
    (value.source === undefined || (typeof value.source === "string" && value.source.length <= 300)) &&
    (value.page === undefined || (typeof value.page === "string" && value.page.length <= 300)) &&
    (value.line === undefined || typeof value.line === "number") &&
    (value.column === undefined || typeof value.column === "number") &&
    (value.occurrences === undefined ||
      (typeof value.occurrences === "number" && Number.isFinite(value.occurrences) && value.occurrences <= 100000))
  );
}

function isCapturedRequest(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.method === "string" &&
    value.method.length <= 20 &&
    typeof value.url === "string" &&
    value.url.length <= 300 &&
    typeof value.timestamp === "string" &&
    value.timestamp.length <= 40 &&
    (value.status === undefined || (typeof value.status === "number" && Number.isFinite(value.status))) &&
    (value.error === undefined || (typeof value.error === "string" && value.error.length <= 200))
  );
}

function isCaptureSnapshotMessage(value: unknown): value is CaptureSnapshotMessage {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Partial<CaptureSnapshotMessage>;
  const snapshot = message.snapshot;
  if (!snapshot) return false;
  let snapshotOrigin: string;
  try {
    snapshotOrigin = new URL(snapshot.url).origin;
  } catch {
    return false;
  }
  return (
    message.source === "devlens" &&
    message.type === "capture-snapshot" &&
    (snapshot.world === "main" || snapshot.world === "isolated") &&
    snapshot.origin === window.location.origin &&
    snapshotOrigin === snapshot.origin &&
    typeof snapshot.url === "string" &&
    typeof snapshot.title === "string" &&
    snapshot.title.length <= 500 &&
    typeof snapshot.startedAt === "string" &&
    snapshot.startedAt.length <= 40 &&
    Array.isArray(snapshot.errors) &&
    snapshot.errors.length <= 100 &&
    snapshot.errors.every(isCapturedError) &&
    (snapshot.requests === undefined ||
      (Array.isArray(snapshot.requests) && snapshot.requests.length <= 100 && snapshot.requests.every(isCapturedRequest))) &&
    (snapshot.lastInteraction === undefined ||
      (Array.isArray(snapshot.lastInteraction) &&
        snapshot.lastInteraction.length <= 5 &&
        snapshot.lastInteraction.every(
          (element) =>
            isRecord(element) &&
            typeof element.tag === "string" &&
            element.tag.length <= 20 &&
            (element.id === undefined || (typeof element.id === "string" && element.id.length <= 100)) &&
            (element.role === undefined || (typeof element.role === "string" && element.role.length <= 50)) &&
            (element.testId === undefined ||
              (typeof element.testId === "string" && element.testId.length <= 100)) &&
            Array.isArray(element.classes) &&
            element.classes.length <= 5 &&
            element.classes.every((name) => typeof name === "string" && name.length <= 50)
        )))
  );
}

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (event.source !== window || event.origin !== window.location.origin || !isCaptureSnapshotMessage(event.data)) {
    return;
  }

  void chrome.runtime.sendMessage({
    type: "devlens:save-capture-snapshot",
    snapshot: event.data.snapshot
  }).then((response: { ok?: boolean; error?: string } | undefined) => {
    if (!response?.ok) {
      console.error("DevLens could not persist capture data.", response?.error ?? "No response from the extension.");
    }
  }).catch((error: unknown) => {
    console.error("DevLens could not persist capture data.", error);
  });
});

window.addEventListener(
  "pagehide",
  () => {
    window.postMessage({ source: "devlens-bridge", type: "request-snapshot" }, window.location.origin);
  },
  { once: true }
);

void chrome.runtime.sendMessage({ type: "devlens:page-ready" }).then(
  (response: { active?: boolean; error?: string } | undefined) => {
    if (response?.error) console.error("DevLens could not resume page-load capture.", response.error);
  },
  (error: unknown) => console.error("DevLens could not resume page-load capture.", error)
);

window.postMessage({ source: "devlens-bridge", type: "request-snapshot" }, window.location.origin);
