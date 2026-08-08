// Minimal Chrome DevTools Protocol client for fetching JavaScript-rendered pages.
// Connects to a remote Chrome/Chromium instance via WebSocket (e.g. Browserless),
// navigates to the target URL, waits for JS execution, and returns the live DOM.

interface PageContent {
  html: string;
  title: string;
  links: string[];
  baseUrl: string;
}

export async function fetchRenderedPage(
  browserWsUrl: string,
  pageUrl: string,
  timeoutMs = 30_000
): Promise<PageContent> {
  let nextId = 1;
  let sessionId: string | undefined;
  let targetId: string | undefined;
  let closed = false;

  const pending = new Map<
    number,
    { resolve: (v: any) => void; reject: (e: Error) => void }
  >();
  const events = new Map<string, (params: any) => void>();

  const ws = new WebSocket(browserWsUrl);

  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error("Browser WebSocket connection timed out")),
      10_000
    );
    ws.onopen = () => {
      clearTimeout(t);
      resolve();
    };
    ws.onerror = () => {
      clearTimeout(t);
      reject(new Error("Browser WebSocket connection failed"));
    };
  });

  ws.onmessage = (evt) => {
    let msg: any;
    try {
      msg = JSON.parse(String(evt.data));
    } catch {
      return;
    }

    if (msg.id !== undefined) {
      const handler = pending.get(msg.id);
      if (handler) {
        pending.delete(msg.id);
        if (msg.error) {
          handler.reject(new Error(msg.error.message || "CDP error"));
        } else {
          handler.resolve(msg.result ?? {});
        }
      }
      return;
    }

    if (msg.method) {
      const key = msg.sessionId
        ? `${msg.sessionId}:${msg.method}`
        : msg.method;
      const listener = events.get(key);
      if (listener) {
        events.delete(key);
        listener(msg.params);
      }
    }
  };

  function send(method: string, params: any = {}, sid?: string): Promise<any> {
    return new Promise((resolve, reject) => {
      if (closed) return reject(new Error("WebSocket closed"));
      const id = nextId++;
      pending.set(id, { resolve, reject });
      const msg: any = { id, method, params };
      if (sid) msg.sessionId = sid;
      ws.send(JSON.stringify(msg));
    });
  }

  function waitForEvent(name: string, sid?: string): Promise<any> {
    return new Promise((resolve) => {
      const key = sid ? `${sid}:${name}` : name;
      events.set(key, resolve);
    });
  }

  function cleanup() {
    closed = true;
    for (const h of pending.values()) h.reject(new Error("Aborted"));
    pending.clear();
    events.clear();
    try {
      ws.close();
    } catch {
      /* already closed */
    }
  }

  const deadline = setTimeout(() => cleanup(), timeoutMs);

  try {
    const { targetId: tid } = await send("Target.createTarget", {
      url: "about:blank",
    });
    targetId = tid;

    const { sessionId: sid } = await send("Target.attachToTarget", {
      targetId: tid,
      flatten: true,
    });
    sessionId = sid;

    await Promise.all([
      send("Page.enable", {}, sid),
      send("Runtime.enable", {}, sid),
      send("Network.enable", {}, sid),
    ]);

    const loadPromise = waitForEvent("Page.loadEventFired", sid);

    await send("Page.navigate", { url: pageUrl }, sid);

    await loadPromise;

    // Let JavaScript settle — wait for network idle (no inflight requests for
    // 1.5 s) or a hard cap of 8 s, whichever comes first.
    await waitForNetworkIdle(sid, 1500, 8000);

    const [htmlEval, titleEval, linksEval] = await Promise.all([
      send(
        "Runtime.evaluate",
        { expression: "document.documentElement.outerHTML", returnByValue: true },
        sid
      ),
      send(
        "Runtime.evaluate",
        { expression: "document.title || ''", returnByValue: true },
        sid
      ),
      send(
        "Runtime.evaluate",
        {
          expression: `JSON.stringify(
            Array.from(document.querySelectorAll('a[href], area[href]'))
              .map(function(el){ return el.getAttribute('href'); })
              .filter(Boolean)
          )`,
          returnByValue: true,
        },
        sid
      ),
    ]);

    try {
      await send("Target.closeTarget", { targetId: tid });
    } catch {
      /* best effort */
    }
    targetId = undefined;

    const rawHtml = htmlEval?.result?.value || "";
    const html =
      (rawHtml.length > 204_800 ? rawHtml.slice(0, 204_800) : rawHtml);
    const title = titleEval?.result?.value || new URL(pageUrl).pathname;

    let links: string[] = [];
    try {
      links = JSON.parse(linksEval?.result?.value || "[]");
    } catch {
      /* malformed */
    }

    let baseUrl = pageUrl;
    const baseMatch = html.match(
      /<base\b[^>]*\bhref\s*=\s*["']([^"']+)["']/i
    );
    if (baseMatch) {
      try {
        baseUrl = new URL(baseMatch[1], pageUrl).toString();
      } catch {
        /* keep page URL */
      }
    }

    return { html, title, links, baseUrl };
  } finally {
    clearTimeout(deadline);
    if (targetId) {
      try {
        await send("Target.closeTarget", { targetId });
      } catch {
        /* best effort */
      }
    }
    cleanup();
  }

  // ── Network-idle helper ──
  // Watches Network.requestWillBeSent / loadingFinished / loadingFailed events.
  // Resolves when no requests have been in-flight for `quietMs`, or after
  // `maxWaitMs` regardless.
  function waitForNetworkIdle(
    sid: string,
    quietMs: number,
    maxWaitMs: number
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      let inflight = 0;
      let quietTimer: ReturnType<typeof setTimeout> | null = null;
      const maxTimer = setTimeout(done, maxWaitMs);

      function done() {
        clearTimeout(maxTimer);
        if (quietTimer) clearTimeout(quietTimer);
        // Remove listeners by replacing with no-ops
        networkListeners.forEach((_, k) => events.delete(k));
        resolve();
      }

      function resetQuiet() {
        if (quietTimer) clearTimeout(quietTimer);
        if (inflight <= 0) {
          quietTimer = setTimeout(done, quietMs);
        }
      }

      const onRequest = () => {
        inflight++;
        if (quietTimer) {
          clearTimeout(quietTimer);
          quietTimer = null;
        }
      };
      const onFinish = () => {
        inflight = Math.max(0, inflight - 1);
        resetQuiet();
      };

      // CDP events are one-shot in our minimal client, so we re-register
      // after each firing.
      const networkListeners = new Map<string, () => void>();

      function listenRepeat(eventName: string, handler: () => void) {
        const key = `${sid}:${eventName}`;
        networkListeners.set(key, handler);
        const wrap = (params: any) => {
          handler();
          // Re-register for the next event
          events.set(key, wrap);
        };
        events.set(key, wrap);
      }

      listenRepeat("Network.requestWillBeSent", onRequest);
      listenRepeat("Network.loadingFinished", onFinish);
      listenRepeat("Network.loadingFailed", onFinish);

      // Start the quiet timer immediately (the page already loaded)
      resetQuiet();
    });
  }
}
