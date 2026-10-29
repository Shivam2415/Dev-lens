const bridgeCaptureScriptId = "devlens-capture-bridge";
const legacyCaptureScriptIds = ["devlens-main-capture", "devlens-isolated-capture"];
const snapshotPrefix = "devlens:capture:";
const activeCapturePrefix = "devlens:active:";

type CaptureSnapshot = {
  world: "main" | "isolated";
  origin: string;
  url: string;
  title: string;
  startedAt: string;
  errors: Array<{
    message: string;
    timestamp: string;
    kind: "runtime" | "console" | "promise";
    occurrences?: number;
    source?: string;
    page?: string;
    line?: number;
    column?: number;
  }>;
  requests?: Array<{
    method: string;
    url: string;
    status?: number;
    error?: string;
    timestamp: string;
  }>;
  lastInteraction?: Array<{
    tag: string;
    id?: string;
    role?: string;
    testId?: string;
    classes: string[];
  }>;
};

type StoredCaptureSnapshot = CaptureSnapshot & {
  frameId: number;
  savedAt: string;
};

let snapshotWriteQueue = Promise.resolve();

function isHttpOrigin(value: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

async function updateCaptureBridgeRegistration() {
  const activeCaptures = await chrome.storage.session.get(null);
  const origins = [
    ...new Set(
      Object.entries(activeCaptures)
        .filter(([key]) => key.startsWith(activeCapturePrefix))
        .map(([, value]) => (value as { origin?: string }).origin)
        .filter((origin): origin is string => typeof origin === "string" && isHttpOrigin(origin))
    )
  ];
  const ids = [bridgeCaptureScriptId, ...legacyCaptureScriptIds];
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids });
  if (registered.length) {
    await chrome.scripting.unregisterContentScripts({ ids: registered.map(({ id }) => id) });
  }
  if (!origins.length) return;

  try {
    await chrome.scripting.registerContentScripts([{
      id: bridgeCaptureScriptId,
      matches: origins.map((origin) => `${origin}/*`),
      js: ["capture-bridge.js"],
      runAt: "document_start",
      allFrames: true,
      persistAcrossSessions: false,
      world: "ISOLATED"
    }]);
  } catch (error) {
    await chrome.scripting.unregisterContentScripts({ ids: [bridgeCaptureScriptId] }).catch((unregisterError: unknown) => {
      console.error("DevLens could not clean up partially registered capture scripts.", unregisterError);
    });
    throw error;
  }
}

async function injectCaptureScripts(tabId: number, frameId?: number) {
  const target: chrome.scripting.InjectionTarget = frameId === undefined
    ? { tabId, allFrames: true }
    : { tabId, frameIds: [frameId] };
  await chrome.scripting.executeScript({
    target,
    files: ["capture.js"],
    world: "MAIN"
  });
  await chrome.scripting.executeScript({
    target,
    files: ["error-capture.js"],
    world: "ISOLATED"
  });
}

async function clearStoredCaptures(tabId: number) {
  await snapshotWriteQueue;
  const prefix = `${snapshotPrefix}${tabId}:`;
  const stored = await chrome.storage.session.get(null);
  const keys = Object.keys(stored).filter((key) => key.startsWith(prefix));
  if (keys.length) await chrome.storage.session.remove(keys);
}

async function startCapture(tabId: number, url: string) {
  const origin = new URL(url).origin;
  if (!isHttpOrigin(origin)) throw new Error("DevLens can capture only HTTP or HTTPS pages.");

  const granted = await chrome.permissions.contains({ origins: [`${origin}/*`] });
  if (!granted) {
    throw new Error("Grant DevLens access to this site by selecting Start on this page in the popup.");
  }

  await clearStoredCaptures(tabId);
  await chrome.storage.session.set({ [`${activeCapturePrefix}${tabId}`]: { origin } });
  try {
    await updateCaptureBridgeRegistration();
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["capture-bridge.js"],
      world: "ISOLATED"
    });
    await injectCaptureScripts(tabId);
  } catch (error) {
    await chrome.storage.session.remove(`${activeCapturePrefix}${tabId}`);
    await updateCaptureBridgeRegistration().catch((cleanupError: unknown) => {
      console.error("DevLens could not clean up capture registration after a failed start.", cleanupError);
    });
    throw error;
  }
}

async function saveCaptureSnapshot(snapshot: CaptureSnapshot, sender: chrome.runtime.MessageSender): Promise<void> {
  const tabId = sender.tab?.id;
  const frameId = sender.frameId;
  if (tabId === undefined || frameId === undefined || !isHttpOrigin(snapshot.origin)) {
    throw new Error("DevLens received a capture snapshot without a valid page context.");
  }
  const senderUrl = sender.url;
  let senderOrigin: string;
  try {
    senderOrigin = senderUrl ? new URL(senderUrl).origin : "";
  } catch {
    senderOrigin = "";
  }
  if (senderOrigin !== snapshot.origin) {
    throw new Error("DevLens rejected a capture snapshot from a different page origin.");
  }

  const active = await chrome.storage.session.get(`${activeCapturePrefix}${tabId}`);
  if ((active[`${activeCapturePrefix}${tabId}`] as { origin?: string } | undefined)?.origin !== snapshot.origin) {
    throw new Error("DevLens rejected a snapshot from a tab without active capture.");
  }

  const key = `${snapshotPrefix}${tabId}:${frameId}:${snapshot.world}:${snapshot.startedAt}`;
  const record: StoredCaptureSnapshot = { ...snapshot, frameId, savedAt: new Date().toISOString() };
  const operation = snapshotWriteQueue.then(async () => {
    const activeDuringWrite = await chrome.storage.session.get(`${activeCapturePrefix}${tabId}`);
    if (
      (activeDuringWrite[`${activeCapturePrefix}${tabId}`] as { origin?: string } | undefined)?.origin !==
      snapshot.origin
    ) {
      return;
    }
    await chrome.storage.session.set({ [key]: record });
    const stored = await chrome.storage.session.get(null);
    const tabPrefix = `${snapshotPrefix}${tabId}:`;
    const tabEntries = Object.entries(stored)
      .filter(([storedKey]) => storedKey.startsWith(tabPrefix))
      .sort((left, right) => {
        const leftRecord = left[1] as StoredCaptureSnapshot;
        const rightRecord = right[1] as StoredCaptureSnapshot;
        return leftRecord.savedAt.localeCompare(rightRecord.savedAt);
      });
    const staleKeys = tabEntries.slice(0, Math.max(0, tabEntries.length - 50)).map(([storedKey]) => storedKey);
    if (staleKeys.length) await chrome.storage.session.remove(staleKeys);
  });
  snapshotWriteQueue = operation.catch((error: unknown) => {
    console.error("DevLens could not save a page-load capture snapshot.", error);
  });
  return operation;
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (typeof message !== "object" || message === null || !("type" in message)) return;
  const request = message as { type: string; [key: string]: unknown };

  if (request.type === "devlens:save-capture-snapshot") {
    const snapshot = request.snapshot as CaptureSnapshot | undefined;
    if (!snapshot || !["main", "isolated"].includes(snapshot.world)) {
      sendResponse({ ok: false, error: "DevLens received an invalid capture snapshot." });
      return;
    }
    void saveCaptureSnapshot(snapshot, sender).then(
      () => sendResponse({ ok: true }),
      (error: unknown) =>
        sendResponse({ ok: false, error: error instanceof Error ? error.message : "Could not save capture data." })
    );
    return true;
  }

  if (request.type === "devlens:start-capture") {
    const tabId = request.tabId;
    const url = request.url;
    if (typeof tabId !== "number" || typeof url !== "string") {
      sendResponse({ ok: false, error: "DevLens received an invalid capture request." });
      return;
    }
    void startCapture(tabId, url).then(
      () => sendResponse({ ok: true }),
      (error: unknown) =>
        sendResponse({ ok: false, error: error instanceof Error ? error.message : "Could not start capture." })
    );
    return true;
  }

  if (request.type === "devlens:page-ready") {
    const tabId = sender.tab?.id;
    const frameId = sender.frameId;
    const senderUrl = sender.url;
    if (tabId === undefined || frameId === undefined || !senderUrl) {
      sendResponse({ active: false });
      return;
    }
    void (async () => {
      const active = await chrome.storage.session.get(`${activeCapturePrefix}${tabId}`);
      const origin = new URL(senderUrl).origin;
      const isActive =
        (active[`${activeCapturePrefix}${tabId}`] as { origin?: string } | undefined)?.origin === origin;
      if (isActive) await injectCaptureScripts(tabId, frameId);
      sendResponse({ active: isActive });
    })().catch((error: unknown) => {
      sendResponse({ active: false, error: error instanceof Error ? error.message : "Could not resume capture." });
    });
    return true;
  }

  if (request.type === "devlens:get-stored-captures") {
    const tabId = request.tabId;
    const origin = request.origin;
    if (typeof tabId !== "number" || typeof origin !== "string") {
      sendResponse({ ok: false, error: "DevLens received an invalid capture query." });
      return;
    }
    void (async () => {
      await snapshotWriteQueue;
      const stored = await chrome.storage.session.get(null);
      const prefix = `${snapshotPrefix}${tabId}:`;
      const snapshots = Object.entries(stored)
        .filter(
          ([key, value]) =>
            key.startsWith(prefix) && (value as StoredCaptureSnapshot).origin === origin
        )
        .map(([, value]) => value as StoredCaptureSnapshot)
        .sort((left, right) => left.savedAt.localeCompare(right.savedAt));
      sendResponse({ ok: true, snapshots });
    })().catch((error: unknown) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : "Could not read captured data." });
    });
    return true;
  }

  if (request.type === "devlens:clear-stored-captures") {
    const tabId = request.tabId;
    if (typeof tabId !== "number") {
      sendResponse({ ok: false, error: "DevLens received an invalid capture cleanup request." });
      return;
    }
    void clearStoredCaptures(tabId).then(
      () => sendResponse({ ok: true }),
      (error: unknown) =>
        sendResponse({ ok: false, error: error instanceof Error ? error.message : "Could not clear captured data." })
    );
    return true;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    await chrome.storage.session.remove(`${activeCapturePrefix}${tabId}`);
    await clearStoredCaptures(tabId);
    await updateCaptureBridgeRegistration();
  })().catch((error: unknown) => {
    console.error("DevLens could not clear capture data for a closed tab.", error);
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url) return;
  void (async () => {
    const active = await chrome.storage.session.get(`${activeCapturePrefix}${tabId}`);
    const key = `${activeCapturePrefix}${tabId}`;
    const activeCapture = active[key] as { origin?: string } | undefined;
    if (!activeCapture) return;
    let updatedOrigin: string;
    try {
      updatedOrigin = new URL(changeInfo.url!).origin;
    } catch {
      updatedOrigin = "";
    }
    if (updatedOrigin === activeCapture.origin) return;
    await chrome.storage.session.remove(key);
    await updateCaptureBridgeRegistration();
  })().catch((error: unknown) => {
    console.error("DevLens could not pause capture after the tab left its site.", error);
  });
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== "capture-bug-report") return;

  void (async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) {
        throw new Error("Open an HTTP or HTTPS page before starting DevLens capture.");
      }
      await startCapture(tab.id, tab.url);
    } catch (error) {
      console.error("DevLens could not start capture from the keyboard shortcut.", error);
    }

    try {
      await chrome.action.openPopup();
    } catch (error) {
      console.error("DevLens could not open its popup after the keyboard shortcut.", error);
    }
  })();
});
