import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { parseHTML } from "npm:linkedom@0.18.13";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PAGE_BYTES = 3 * 1024 * 1024;
const RASTER_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function attr(html: string, name: string): string | null {
  const m = html.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
  return m ? (m[2] ?? m[3] ?? "").trim() : null;
}

function firstSrcsetUrl(srcset: string | null): string | null {
  if (!srcset) return null;
  const first = srcset.split(",")[0]?.trim().split(/\s+/)[0];
  return first || null;
}

function resolveImageUrl(element: string, pageUrl: string): string | null {
  const candidates = [
    attr(element, "src"),
    attr(element, "data-lazy-src"),
    attr(element, "data-src"),
    attr(element, "data-original"),
    firstSrcsetUrl(attr(element, "srcset")),
    firstSrcsetUrl(attr(element, "data-lazy-srcset")),
    firstSrcsetUrl(attr(element, "data-srcset")),
  ];
  for (const c of candidates) {
    if (!c || c.startsWith("data:") || c.startsWith("blob:")) continue;
    try {
      const u = new URL(c.replace(/&amp;/g, "&"), pageUrl);
      if (u.protocol === "http:" || u.protocol === "https:") return u.toString();
    } catch { /* try next */ }
  }
  return null;
}

function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "::1" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd") || h === "::") return true;
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }
  return false;
}

async function safeFetch(rawUrl: string, timeoutMs: number, accept: string): Promise<Response | null> {
  let current = rawUrl;
  for (let hop = 0; hop < 4; hop++) {
    const u = new URL(current);
    if ((u.protocol !== "http:" && u.protocol !== "https:") || isBlockedHost(u.hostname)) return null;
    const res = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ADA-Scanner/1.0)",
        "Accept": accept,
      },
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return null;
      current = new URL(loc, current).toString();
      continue;
    }
    return res.ok ? res : null;
  }
  return null;
}

async function readLimited(res: Response, limit: number): Promise<Uint8Array | null> {
  const reader = res.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function clean(text: string | null | undefined, max: number): string {
  return (text ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

interface PageContext {
  pageTitle: string;
  heading: string;
  caption: string;
  nearbyText: string;
  linkText: string;
}

async function getPageContext(pageUrl: string, imageUrl: string, storedTitle: string): Promise<PageContext> {
  const ctx: PageContext = { pageTitle: clean(storedTitle, 200), heading: "", caption: "", nearbyText: "", linkText: "" };
  try {
    const res = await safeFetch(pageUrl, 8000, "text/html,application/xhtml+xml");
    if (!res) return ctx;
    const bytes = await readLimited(res, MAX_PAGE_BYTES);
    if (!bytes) return ctx;
    const { document } = parseHTML(new TextDecoder().decode(bytes));
    document.querySelectorAll("script,style,noscript,template").forEach((n: any) => n.remove());

    if (!ctx.pageTitle) ctx.pageTitle = clean(document.querySelector("title")?.textContent, 200);
    ctx.heading = clean(document.querySelector("h1")?.textContent, 200);

    const fileName = new URL(imageUrl).pathname.split("/").pop() ?? "";
    const img = Array.from(document.querySelectorAll("img")).find((el: any) => {
      const vals = ["src", "data-src", "data-lazy-src", "srcset", "data-srcset", "data-lazy-srcset"]
        .map((a) => el.getAttribute(a) || "");
      return vals.some((v) => v && (v.includes(imageUrl) || (fileName.length > 4 && v.includes(fileName))));
    }) as any;
    if (!img) return ctx;

    ctx.caption = clean(img.closest("figure")?.querySelector("figcaption")?.textContent, 300);
    const link = img.closest("a");
    if (link) ctx.linkText = clean(link.textContent, 200) || clean(link.getAttribute("href"), 200);

    let node = img.parentElement;
    while (node && clean(node.textContent, 400).length < 40 && node.tagName !== "BODY") {
      node = node.parentElement;
    }
    if (node && node.tagName !== "BODY") ctx.nearbyText = clean(node.textContent, 400);
  } catch { /* page context is best-effort */ }
  return ctx;
}

interface ImagePayload {
  kind: "raster" | "svg";
  dataUrl?: string;
  svgSource?: string;
}

async function loadImage(imageUrl: string): Promise<ImagePayload | null> {
  try {
    const res = await safeFetch(imageUrl, 10000, "image/avif,image/webp,image/png,image/jpeg,image/*");
    if (!res) return null;
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const bytes = await readLimited(res, MAX_IMAGE_BYTES);
    if (!bytes || bytes.byteLength === 0) return null;
    if (type === "image/svg+xml" || /\.svg($|\?)/i.test(imageUrl)) {
      return { kind: "svg", svgSource: new TextDecoder().decode(bytes).slice(0, 6000) };
    }
    if (RASTER_TYPES.includes(type)) {
      const mime = type === "image/jpg" ? "image/jpeg" : type;
      return { kind: "raster", dataUrl: `data:${mime};base64,${toBase64(bytes)}` };
    }
    return null;
  } catch {
    return null;
  }
}

const SYSTEM_PROMPT = `You write HTML alt text for web accessibility (WCAG 1.1.1).
Rules:
- Describe only what is actually visible in the image and relevant to its purpose on this page. Never invent names, places, brands, numbers or details that are not visible in the image or stated in the page context.
- If the image contains meaningful text (logo, banner, chart title), include that text.
- If the image is a logo, use the brand/organisation name (e.g. "Tripadvisor"), adding "logo" only if helpful.
- If the image is inside a link, describe the link's purpose rather than the picture.
- Keep it concise: one short phrase or sentence, ideally under 125 characters. No trailing period for short phrases.
- Do not start with "image of", "picture of", "photo of" or similar.
- If the image is purely decorative (spacer, divider, ornamental shape, background texture, or it duplicates adjacent text), set decorative to true and alt to an empty string.
Respond with JSON only.`;

async function generateAlt(apiKey: string, image: ImagePayload, imageUrl: string, ctx: PageContext) {
  const contextLines = [
    `Image file: ${new URL(imageUrl).pathname.split("/").pop() ?? ""}`,
    ctx.pageTitle && `Page title: ${ctx.pageTitle}`,
    ctx.heading && `Main heading: ${ctx.heading}`,
    ctx.caption && `Figure caption: ${ctx.caption}`,
    ctx.linkText && `Image is inside a link: ${ctx.linkText}`,
    ctx.nearbyText && `Nearby text: ${ctx.nearbyText}`,
  ].filter(Boolean).join("\n");

  const userContent: unknown[] = [{ type: "text", text: `Page context:\n${contextLines}` }];
  if (image.kind === "raster") {
    userContent.push({ type: "image_url", image_url: { url: image.dataUrl, detail: "low" } });
  } else {
    userContent.push({ type: "text", text: `The image is an SVG. Its source code:\n${image.svgSource}` });
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(30000),
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "alt_text",
          strict: true,
          schema: {
            type: "object",
            properties: {
              decorative: { type: "boolean" },
              alt: { type: "string" },
            },
            required: ["decorative", "alt"],
            additionalProperties: false,
          },
        },
      },
    }),
  });
  if (!res.ok) throw new Error(`AI request failed (${res.status})`);
  const data = await res.json();
  const parsed = JSON.parse(data?.choices?.[0]?.message?.content ?? "{}");
  if (typeof parsed.decorative !== "boolean" || typeof parsed.alt !== "string") {
    throw new Error("AI returned an unexpected response");
  }
  const decorative = parsed.decorative;
  const altText = decorative ? "" : clean(parsed.alt.replace(/"/g, "'"), 250);
  if (!decorative && !altText) throw new Error("AI returned empty alt text");
  return { decorative, altText };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const body = await req.json().catch(() => null);
    const resultId = typeof body?.resultId === "string" ? body.resultId : "";
    if (!UUID_RE.test(resultId)) return json({ error: "Invalid request" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: cached } = await supabase
      .from("alt_text_suggestions")
      .select("image_url, alt_text, decorative")
      .eq("result_id", resultId)
      .maybeSingle();
    if (cached) {
      return json({ imageUrl: cached.image_url, altText: cached.alt_text, decorative: cached.decorative });
    }

    const { data: result, error: resultError } = await supabase
      .from("scan_results")
      .select("rule_id, element, page_id")
      .eq("id", resultId)
      .maybeSingle();
    if (resultError || !result || result.rule_id !== "image-alt" || !result.element) {
      return json({ error: "Image issue not found" }, 404);
    }

    const { data: page } = await supabase
      .from("scan_pages")
      .select("url, title")
      .eq("id", result.page_id)
      .maybeSingle();
    if (!page?.url) return json({ error: "Image issue not found" }, 404);

    const imageUrl = resolveImageUrl(result.element, page.url);
    if (!imageUrl) return json({ error: "This image has no address that can be analysed." }, 422);

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) return json({ error: "AI alt text is not set up yet.", code: "missing_key" }, 503);

    const [image, ctx] = await Promise.all([
      loadImage(imageUrl),
      getPageContext(page.url, imageUrl, page.title ?? ""),
    ]);
    if (!image) return json({ error: "The image could not be loaded for analysis." }, 422);

    const { decorative, altText } = await generateAlt(apiKey, image, imageUrl, ctx);

    await supabase
      .from("alt_text_suggestions")
      .upsert({ result_id: resultId, image_url: imageUrl, alt_text: altText, decorative }, { onConflict: "result_id", ignoreDuplicates: true });

    const { data: saved } = await supabase
      .from("alt_text_suggestions")
      .select("image_url, alt_text, decorative")
      .eq("result_id", resultId)
      .maybeSingle();
    const final = saved ?? { image_url: imageUrl, alt_text: altText, decorative };

    return json({ imageUrl: final.image_url, altText: final.alt_text, decorative: final.decorative });
  } catch (err) {
    console.error("suggest-alt-text error:", err);
    return json({ error: "Could not generate alt text right now. Please try again." }, 500);
  }
});
