const API_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/suggest-alt-text`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export type AltSuggestion =
  | { status: "loading" }
  | { status: "ready"; altText: string; decorative: boolean }
  | { status: "error"; message: string; notConfigured: boolean };

const MAX_RATE_LIMIT_RETRIES = 4;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createRequestQueue(concurrency: number) {
  let active = 0;
  const pending: Array<() => void> = [];
  const next = () => {
    if (active >= concurrency) return;
    const job = pending.shift();
    if (job) job();
  };
  return function enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve) => {
      pending.push(() => {
        active++;
        task().then(resolve).finally(() => {
          active--;
          next();
        });
      });
      next();
    });
  };
}

export async function fetchAltSuggestion(resultId: string): Promise<AltSuggestion> {
  for (let attempt = 0; ; attempt++) {
    const outcome = await requestOnce(resultId);
    if (!("retryAfterMs" in outcome)) return outcome;
    if (attempt >= MAX_RATE_LIMIT_RETRIES) {
      return { status: "error", message: "The AI is busy right now. Please try again in a minute.", notConfigured: false };
    }
    await wait(outcome.retryAfterMs + Math.random() * 1000);
  }
}

async function requestOnce(resultId: string): Promise<AltSuggestion | { retryAfterMs: number }> {
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": ANON_KEY,
        "Authorization": `Bearer ${ANON_KEY}`,
      },
      body: JSON.stringify({ resultId }),
    });
    const body = await res.json().catch(() => null);
    if (res.status === 429 && body?.code === "rate_limited") {
      return { retryAfterMs: typeof body.retryAfterMs === "number" ? body.retryAfterMs : 15000 };
    }
    if (!res.ok) {
      return {
        status: "error",
        message: typeof body?.error === "string" ? body.error : "Could not generate alt text right now.",
        notConfigured: body?.code === "missing_key",
      };
    }
    if (typeof body?.altText !== "string" || typeof body?.decorative !== "boolean") {
      return { status: "error", message: "Received an unexpected response.", notConfigured: false };
    }
    return { status: "ready", altText: body.altText, decorative: body.decorative };
  } catch {
    return { status: "error", message: "Network error. Check your connection and try again.", notConfigured: false };
  }
}

function readAttr(html: string, name: string): string | null {
  const m = html.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
  return m ? (m[2] ?? m[3] ?? "").trim() : null;
}

export function resolveImageSource(element: string, pageUrl: string): string | null {
  const firstOfSet = (v: string | null) => v?.split(",")[0]?.trim().split(/\s+/)[0] || null;
  const candidates = [
    readAttr(element, "src"),
    readAttr(element, "data-lazy-src"),
    readAttr(element, "data-src"),
    readAttr(element, "data-original"),
    firstOfSet(readAttr(element, "srcset")),
    firstOfSet(readAttr(element, "data-lazy-srcset")),
    firstOfSet(readAttr(element, "data-srcset")),
  ];
  for (const c of candidates) {
    if (!c || c.startsWith("data:") || c.startsWith("blob:")) continue;
    try {
      const u = new URL(c.replace(/&amp;/g, "&"), pageUrl);
      if (u.protocol === "http:" || u.protocol === "https:") return u.toString();
    } catch { /* try next candidate */ }
  }
  return null;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

export function altAttribute(altText: string): string {
  return `alt="${escapeAttr(altText)}"`;
}

export function withAltAttribute(element: string, altText: string): string {
  return element.replace(/^<img\b/i, `<img ${altAttribute(altText)}`);
}
