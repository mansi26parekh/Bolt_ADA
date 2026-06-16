import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Pre-compiled ARIA reference regexes — avoids new RegExp() inside hot loops
const ARIA_REF_RES: Array<[string, RegExp]> = [
  ["aria-labelledby", /\baria-labelledby\s*=\s*["']([^"']+)["']/i],
  ["aria-describedby", /\baria-describedby\s*=\s*["']([^"']+)["']/i],
  ["aria-controls", /\baria-controls\s*=\s*["']([^"']+)["']/i],
  ["aria-owns", /\baria-owns\s*=\s*["']([^"']+)["']/i],
];

// Set for O(1) tracking-param lookup
const TRACKING_PARAMS_SET = new Set([
  "utm_source","utm_medium","utm_campaign","utm_content","utm_term",
  "ref","fbclid","gclid","source","affiliate","tracking",
]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const path = url.pathname.replace("/ada-scan", "") || "/";

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (req.method === "GET" && path.startsWith("/") && path.length > 1) {
      const scanId = path.slice(1);
      const { data: scan, error: scanError } = await supabase
        .from("scans").select("*").eq("id", scanId).maybeSingle();

      if (scanError || !scan) {
        return new Response(JSON.stringify({ error: "Scan not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: pages } = await supabase
        .from("scan_pages").select("*").eq("scan_id", scanId).order("created_at", { ascending: true });
      const { data: results } = await supabase
        .from("scan_results").select("*").eq("scan_id", scanId).order("created_at", { ascending: true });

      return new Response(
        JSON.stringify({ scan, pages: pages || [], results: results || [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (req.method === "POST" && path === "/") {
      const body = await req.json();
      const targetUrl = body.url;
      const maxDepth = body.maxDepth || 3;

      if (!targetUrl) {
        return new Response(JSON.stringify({ error: "URL is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: scan, error: scanError } = await supabase
        .from("scans")
        .insert({ url: targetUrl, status: "running", max_depth: maxDepth, total_pages: 0, pages_scanned: 0 })
        .select().single();

      if (scanError || !scan) {
        return new Response(JSON.stringify({ error: "Failed to create scan" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const maxPages: number = body.maxPages || Infinity;

      EdgeRuntime.waitUntil(
        (async () => {
          try {
            await runMultiPageScan(supabase, scan.id, targetUrl, maxDepth, maxPages);
          } catch (err) {
            console.error("Scan failed:", err);
            await supabase
              .from("scans")
              .update({ status: "failed", completed_at: new Date().toISOString() })
              .eq("id", scan.id);
          }
        })()
      );

      return new Response(JSON.stringify({ scanId: scan.id }), {
        status: 201,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ─── Multi-page scan orchestrator ───

const CONCURRENCY = 8;
const NON_HTML_RE = /\.(pdf|jpg|jpeg|png|gif|svg|css|js|ico|woff2?|ttf|eot|mp4|mp3|zip|docx?|xlsx?|pptx?)$/i;

function normalizeUrl(href: string, baseUrl: string): string | null {
  try {
    const base = new URL(baseUrl);
    const resolved = new URL(href, base);
    if (!["http:", "https:"].includes(resolved.protocol)) return null;
    resolved.hash = "";
    let normalized = resolved.toString();
    if (normalized.endsWith("/") && normalized.length > base.origin.length + 1) {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  } catch {
    return null;
  }
}

// rootOriginLen pre-computed once per scan to avoid repeated URL parsing
function dedupeUrl(raw: string, base: string, rootOriginLen: number): string | null {
  const norm = normalizeUrl(raw, base);
  if (!norm) return null;
  try {
    const u = new URL(norm);
    // Only iterate if there are actually search params to remove
    if (u.search) {
      u.searchParams.forEach((_, key) => {
        if (TRACKING_PARAMS_SET.has(key)) u.searchParams.delete(key);
      });
    }
    let s = u.toString();
    if (s.endsWith("/") && s.length > rootOriginLen + 1) s = s.slice(0, -1);
    return s;
  } catch {
    return norm;
  }
}

async function runMultiPageScan(
  supabase: ReturnType<typeof createClient>,
  scanId: string,
  rootUrl: string,
  maxDepth: number,
  maxPages: number
) {
  const visited = new Set<string>();
  const queue: { url: string; depth: number }[] = [];
  const allViolations: { impact: string }[] = [];
  let totalPasses = 0;
  let pagesQueued = 0;
  let pagesScanned = 0;

  // Parse root URL once — hostname and origin length reused for every link check
  let rootHostname: string;
  let rootOriginLen: number;
  try {
    const rootParsed = new URL(rootUrl);
    rootHostname = rootParsed.hostname;
    rootOriginLen = rootParsed.origin.length;
  } catch {
    await supabase.from("scans").update({ status: "failed", completed_at: new Date().toISOString() }).eq("id", scanId);
    return;
  }

  const root = dedupeUrl(rootUrl, rootUrl, rootOriginLen);
  if (!root) {
    await supabase.from("scans").update({ status: "failed", completed_at: new Date().toISOString() }).eq("id", scanId);
    return;
  }
  visited.add(root);
  queue.push({ url: root, depth: 0 });

  const processPage = async (url: string, depth: number) => {
    // Run DB insert and HTTP fetch in parallel — saves ~100ms per page
    const insertPromise = supabase
      .from("scan_pages")
      .insert({ scan_id: scanId, url, depth, status: "running", title: null })
      .select("id")
      .single();

    let pageData: { html: string; title: string; links: string[] };
    try {
      pageData = await fetchPage(url);
    } catch (err) {
      console.error(`Fetch failed: ${url}`, err);
      const { data: pageRecord } = await insertPromise;
      if (pageRecord) {
        await supabase.from("scan_pages")
          .update({ status: "failed", completed_at: new Date().toISOString() })
          .eq("id", pageRecord.id);
      }
      return;
    }

    const { data: pageRecord } = await insertPromise;

    // Enqueue discovered links
    for (const link of pageData.links) {
      const norm = dedupeUrl(link, rootUrl, rootOriginLen);
      if (!norm || visited.has(norm) || visited.size >= maxPages) continue;
      if (depth + 1 > maxDepth || NON_HTML_RE.test(norm)) continue;
      try {
        if (new URL(norm).hostname !== rootHostname) continue;
      } catch {
        continue;
      }
      visited.add(norm);
      queue.push({ url: norm, depth: depth + 1 });
    }

    if (!pageRecord) return;

    const cleanHtml = pageData.html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "");

    const { violations: analysis, passCount } = analyzeAccessibility(pageData.html, url, cleanHtml);
    const pageScore = calculatePageScore(analysis, passCount);

    const resultRows = analysis.map((v) => ({
      page_id: pageRecord.id,
      scan_id: scanId,
      impact: v.impact,
      category: v.category,
      rule_id: v.ruleId,
      title: v.title,
      description: v.description,
      help_url: v.helpUrl,
      element: v.element,
      selector: v.selector,
    }));

    const writes: Promise<unknown>[] = [
      supabase.from("scan_pages").update({
        status: "completed",
        title: pageData.title,
        score: pageScore,
        violation_count: analysis.length,
        pass_count: passCount,
        completed_at: new Date().toISOString(),
      }).eq("id", pageRecord.id),
    ];
    for (let i = 0; i < resultRows.length; i += 100) {
      writes.push(supabase.from("scan_results").insert(resultRows.slice(i, i + 100)));
    }
    await Promise.all(writes);

    allViolations.push(...analysis.map((v) => ({ impact: v.impact })));
    totalPasses += passCount;
    pagesScanned++;

    if (pagesScanned % 5 === 0) {
      supabase.from("scans").update({ pages_scanned: pagesScanned }).eq("id", scanId).then(() => {});
    }
  };

  const activeWorkers = new Set<Promise<void>>();
  const trySpawn = () => {
    while (activeWorkers.size < CONCURRENCY && queue.length > 0 && pagesQueued < maxPages) {
      const item = queue.shift()!;
      pagesQueued++;
      const p: Promise<void> = processPage(item.url, item.depth)
        .catch((err) => console.error("Worker error:", err))
        .finally(() => activeWorkers.delete(p)) as Promise<void>;
      activeWorkers.add(p);
    }
  };

  trySpawn();
  while (activeWorkers.size > 0) {
    await Promise.race(activeWorkers);
    trySpawn();
  }

  const overallScore = calculateOverallScore(allViolations, pagesScanned);
  await supabase.from("scans").update({
    status: "completed",
    score: overallScore,
    total_violations: allViolations.length,
    total_passes: totalPasses,
    total_pages: pagesScanned,
    pages_scanned: pagesScanned,
    completed_at: new Date().toISOString(),
  }).eq("id", scanId);
}

// ─── Page fetching ───

async function fetchPage(url: string): Promise<{ html: string; title: string; links: string[] }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s — fail fast on slow pages

  let response: Response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ADA-Scanner/2.0; +https://ada-scanner.dev)",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
    throw new Error(`Non-HTML content type: ${contentType}`);
  }

  const rawHtml = await response.text();
  // Cap at 200KB — covers the vast majority of page content, keeps analysis fast
  const html = rawHtml.length > 204_800 ? rawHtml.slice(0, 204_800) : rawHtml;

  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1].trim()) : new URL(url).pathname;

  const linkRegex = /<a[^>]+href\s*=\s*["']([^"']+)["']/gi;
  const links: string[] = [];
  let m;
  while ((m = linkRegex.exec(html)) !== null) links.push(m[1]);

  return { html, title, links };
}

function decodeEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ");
}

// ─── Accessibility analysis ───

interface Violation {
  impact: string; category: string; ruleId: string; title: string;
  description: string; helpUrl: string; element: string; selector: string;
}

const VIOLATION_TITLES: Record<string, string> = {
  "image-alt": "Missing image alternative text",
  "image-alt-empty-link": "Linked image missing alt text",
  "input-image-alt": "Image button missing alternative text",
  "html-lang-valid": "Missing or invalid page language",
  "document-title": "Missing or empty page title",
  "label": "Missing form label",
  "label-empty": "Empty form label",
  "label-orphaned": "Orphaned form label",
  "button-name": "Empty button",
  "link-name": "Empty link",
  "empty-heading": "Empty heading",
  "heading-order": "Skipped heading level",
  "heading-missing": "No headings on page",
  "heading-first-missing": "No first-level heading",
  "frame-title": "Iframe missing title",
  "role-presentation": "Focusable element with presentation role",
  "aria-hidden-focus": "Focusable element hidden from screen readers",
  "aria-reference-broken": "Broken ARIA reference",
  "duplicate-id": "Duplicate ID",
  "blink": "Blinking content",
  "marquee": "Scrolling/marquee content",
  "table-fake": "Data table missing header cells",
  "video-autoplay": "Video autoplays without controls",
  "audio-autoplay": "Audio autoplays without controls",
  "meta-viewport": "Page zoom disabled",
  "meta-refresh": "Timed page refresh",
};

function v(
  ruleId: string, impact: string, category: string,
  description: string, helpUrl: string, element: string, selector: string
): Violation {
  return { impact, category, ruleId, title: VIOLATION_TITLES[ruleId] || "Accessibility issue",
    description, helpUrl, element, selector };
}

// Single-pass analysis — merges all element scans and pass counting into one traversal per element type.
// Previously analyzeAccessibility + countPasses scanned links 4×, images 3×, inputs 2×, buttons 2×.
function analyzeAccessibility(
  html: string, _pageUrl: string, preClean?: string
): { violations: Violation[]; passCount: number } {
  const violations: Violation[] = [];
  let passCount = 0;

  const cleanHtml = preClean ?? html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  // Pre-compute noscript ranges — O(1) lookup per element vs O(n) substring scan
  const noscriptRanges: Array<[number, number]> = [];
  const _nscriptRe = /<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi;
  let _nsm: RegExpExecArray | null;
  while ((_nsm = _nscriptRe.exec(cleanHtml)) !== null) {
    noscriptRanges.push([_nsm.index, _nsm.index + _nsm[0].length]);
  }
  const inNoscript = (pos: number) => noscriptRanges.some(([s, e]) => pos >= s && pos <= e);

  // Pre-compute all IDs
  const allIds = new Set<string>();
  const allIdRe = /\bid\s*=\s*["']([^"']+)["']/gi;
  let aim: RegExpExecArray | null;
  while ((aim = allIdRe.exec(cleanHtml)) !== null) allIds.add(aim[1]);

  // Pre-compute implicit label positions (inputs inside <label>)
  const implicitLabeledPositions = new Set<number>();
  const labelBlockRe = /<label\b[^>]*>[\s\S]*?<\/label>/gi;
  let lbm: RegExpExecArray | null;
  while ((lbm = labelBlockRe.exec(cleanHtml)) !== null) {
    const offset = lbm.index;
    const innerRe = /<(?:input|select|textarea)\b[^>]*>/gi;
    let im: RegExpExecArray | null;
    while ((im = innerRe.exec(lbm[0])) !== null) implicitLabeledPositions.add(offset + im.index);
  }

  // Pre-compute label for= targets — avoids per-element regex compilation
  const labelForIds = new Set<string>();
  const labelForRe = /<label\b[^>]*\bfor\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let lfm: RegExpExecArray | null;
  while ((lfm = labelForRe.exec(cleanHtml)) !== null) labelForIds.add(lfm[1]);

  // Pre-compute ARIA-referenced + label-referenced IDs — duplicate-id only fires for these
  const referencedIds = new Set<string>(labelForIds);
  const ariaRefCollRe = /\b(?:aria-labelledby|aria-describedby|aria-controls|aria-owns)\s*=\s*["']([^"']+)["']/gi;
  let arcm: RegExpExecArray | null;
  while ((arcm = ariaRefCollRe.exec(cleanHtml)) !== null) {
    for (const refId of arcm[1].trim().split(/\s+/)) {
      if (refId) referencedIds.add(refId);
    }
  }

  let match: RegExpExecArray | null;

  function controlHasLabel(tag: string, idx: number): boolean {
    if (implicitLabeledPositions.has(idx)) return true;
    if (/\baria-label\s*=\s*["'][^"']+["']/i.test(tag)) return true;
    if (/\baria-labelledby\s*=\s*["'][^"']+["']/i.test(tag)) return true;
    if (/\btitle\s*=\s*["'][^"']+["']/i.test(tag)) return true;
    const idm = /\bid\s*=\s*["']([^"']+)["']/i.exec(tag);
    return !!(idm && labelForIds.has(idm[1]));
  }

  // ── 1. Images: missing alt + pass count — single scan ──
  const imgRe = /<img\b[^>]*>/gi;
  while ((match = imgRe.exec(cleanHtml)) !== null) {
    const tag = match[0];
    if (inNoscript(match.index)) continue;
    if (/\brole\s*=\s*["'](?:presentation|none)["']/i.test(tag)) continue;
    if (!/\balt\s*=/i.test(tag)) {
      violations.push(v("image-alt", "error", "WCAG 1.1.1",
        "Image is missing an alt attribute. Screen readers cannot convey the image's content or purpose to non-sighted users.",
        "https://dequeuniversity.com/rules/axe/4.9/image-alt", truncate(tag, 200), buildSelector(tag)));
    } else if (/\balt\s*=\s*["'][^"']+["']/i.test(tag)) {
      passCount++;
    }
  }

  // ── 2+11. Links: linked-image alt + empty link + pass count — single scan ──
  const linkRe = /<a\b[^>]*\bhref\b[^>]*>([\s\S]*?)<\/a>/gi;
  while ((match = linkRe.exec(cleanHtml)) !== null) {
    const fullTag = match[0];
    const openTag = fullTag.match(/<a[^>]*/i)?.[0] || "";
    const inner = match[1];
    if (inNoscript(match.index)) continue;

    const hasAL  = /\baria-label\s*=\s*["'][^"']+["']/i.test(openTag);
    const hasALB = /\baria-labelledby\s*=\s*["'][^"']+["']/i.test(openTag);
    const hasT   = /\btitle\s*=\s*["'][^"']+["']/i.test(openTag);
    const hasImgAlt = /<img[^>]+\balt\s*=\s*["'][^"']+["']/i.test(inner);
    const hasSvg = /<svg[^>]+\baria-label\s*=\s*["'][^"']+["']/i.test(inner) ||
                   (/<svg\b/i.test(inner) && /<title\b[^>]*>[^<]+<\/title>/i.test(inner));
    const text = decodeEntities(inner.replace(/<[^>]*>/g, "")).trim();

    // Check #2: linked image with no accessible text
    if (/<img\b/i.test(inner) && !hasImgAlt && !hasAL && !hasALB && !hasT && text.length === 0) {
      violations.push(v("image-alt-empty-link", "error", "WCAG 1.1.1",
        "A linked image has an empty or missing alt attribute and the link contains no other text. Screen readers cannot determine the link's purpose.",
        "https://dequeuniversity.com/rules/axe/4.9/image-alt", truncate(fullTag, 200), buildSelector(fullTag)));
    }

    // Check #11: empty link
    if (!/\baria-hidden\s*=\s*["']true["']/i.test(openTag)) {
      const accessible = hasAL || hasALB || hasT || hasImgAlt || hasSvg || text.length > 0;
      if (!accessible) {
        violations.push(v("link-name", "error", "WCAG 4.1.2",
          "Link has no accessible text. Screen readers cannot convey this link's purpose to the user.",
          "https://dequeuniversity.com/rules/axe/4.9/link-name", truncate(fullTag, 200), buildSelector(fullTag)));
      } else {
        passCount++;
      }
    }
  }

  // ── 3. HTML lang ──
  const htmlTag = cleanHtml.match(/<html\b[^>]*>/i);
  if (htmlTag && !/\blang\s*=/i.test(htmlTag[0])) {
    violations.push(v("html-lang-valid", "error", "WCAG 3.1.1",
      "The <html> element does not have a lang attribute. Screen readers use this to select the correct voice and pronunciation engine.",
      "https://dequeuniversity.com/rules/axe/4.9/html-lang-valid", "<html>", "html"));
  } else if (htmlTag) {
    passCount++;
  }

  // ── 4. Document title ──
  const titleMatch = cleanHtml.match(/<title\b[^>]*>([^<]*)<\/title>/i);
  if (!titleMatch || titleMatch[1].trim().length === 0) {
    violations.push(v("document-title", "error", "WCAG 2.4.2",
      "Document does not have a meaningful <title> element. Page titles identify each page in browser history, bookmarks, and screen reader announcements.",
      "https://dequeuniversity.com/rules/axe/4.9/document-title", "<title>", "head > title"));
  } else {
    passCount++;
  }

  // ── 5+6+7. Form controls: missing label + pass count — single scan per type ──
  const inputRe = /<input\b[^>]*>/gi;
  while ((match = inputRe.exec(cleanHtml)) !== null) {
    const tag = match[0];
    if (inNoscript(match.index)) continue;
    const tm = /\btype\s*=\s*["']([^"']+)["']/i.exec(tag);
    const inputType = tm ? tm[1].toLowerCase() : "text";
    if (inputType === "image") {
      if (!/\balt\s*=\s*["'][^"']*["']/i.test(tag)) {
        violations.push(v("input-image-alt", "error", "WCAG 1.1.1",
          "Image input button is missing an alt attribute. Screen readers cannot identify this button's purpose.",
          "https://dequeuniversity.com/rules/axe/4.9/input-image-alt", truncate(tag, 200), buildSelector(tag)));
      }
      continue;
    }
    if (["hidden", "submit", "reset", "button"].includes(inputType)) continue;
    if (controlHasLabel(tag, match.index)) {
      passCount++;
    } else {
      violations.push(v("label", "error", "WCAG 1.3.1",
        "Form input does not have an associated label. Users relying on screen readers or voice control cannot determine what information to enter.",
        "https://dequeuniversity.com/rules/axe/4.9/label", truncate(tag, 200), buildSelector(tag)));
    }
  }

  const selectRe = /<select\b[^>]*>/gi;
  while ((match = selectRe.exec(cleanHtml)) !== null) {
    const tag = match[0];
    if (inNoscript(match.index)) continue;
    if (!controlHasLabel(tag, match.index)) {
      violations.push(v("label", "error", "WCAG 1.3.1",
        "Select (dropdown) element does not have an associated label. Screen reader users cannot identify the purpose of this control.",
        "https://dequeuniversity.com/rules/axe/4.9/label", truncate(tag, 200), buildSelector(tag)));
    }
  }

  const textareaRe = /<textarea\b[^>]*>/gi;
  while ((match = textareaRe.exec(cleanHtml)) !== null) {
    const tag = match[0];
    if (inNoscript(match.index)) continue;
    if (!controlHasLabel(tag, match.index)) {
      violations.push(v("label", "error", "WCAG 1.3.1",
        "Textarea element does not have an associated label.",
        "https://dequeuniversity.com/rules/axe/4.9/label", truncate(tag, 200), buildSelector(tag)));
    }
  }

  // ── 8. Empty labels ──
  const labelFullRe = /<label\b[^>]*>([\s\S]*?)<\/label>/gi;
  while ((match = labelFullRe.exec(cleanHtml)) !== null) {
    const inner = match[1];
    const text = decodeEntities(inner.replace(/<[^>]*>/g, "")).trim();
    if (text.length === 0 && !/<img[^>]+\balt\s*=\s*["'][^"']+["']/i.test(inner)) {
      violations.push(v("label-empty", "error", "WCAG 1.3.1",
        "A <label> element exists but is empty. An empty label provides no information to screen reader users about the associated form control.",
        "https://dequeuniversity.com/rules/axe/4.9/label", truncate(match[0], 200), "label"));
    }
  }

  // ── 9. Orphaned labels ──
  const orphanRe = /<label\b[^>]*\bfor\s*=\s*["']([^"']+)["'][^>]*>/gi;
  while ((match = orphanRe.exec(cleanHtml)) !== null) {
    if (!allIds.has(match[1])) {
      violations.push(v("label-orphaned", "error", "WCAG 1.3.1",
        `Label has for="${match[1]}" but no element with that ID exists on this page. The label is not associated with any form control.`,
        "https://dequeuniversity.com/rules/axe/4.9/label", truncate(match[0], 200), `label[for="${match[1]}"]`));
    }
  }

  // ── 10. Buttons: empty + pass count — single scan ──
  const btnRe = /<button\b[^>]*>([\s\S]*?)<\/button>/gi;
  while ((match = btnRe.exec(cleanHtml)) !== null) {
    const fullTag = match[0];
    const openTag = fullTag.match(/<button[^>]*/i)?.[0] || "";
    const inner = match[1];
    if (inNoscript(match.index)) continue;
    const accessible =
      /\baria-label\s*=\s*["'][^"']+["']/i.test(openTag) ||
      /\baria-labelledby\s*=\s*["'][^"']+["']/i.test(openTag) ||
      /\btitle\s*=\s*["'][^"']+["']/i.test(openTag) ||
      /<img[^>]+\balt\s*=\s*["'][^"']+["']/i.test(inner) ||
      /<svg[^>]+\baria-label\s*=\s*["'][^"']+["']/i.test(inner) ||
      (/<svg\b/i.test(inner) && /<title\b[^>]*>[^<]+<\/title>/i.test(inner)) ||
      decodeEntities(inner.replace(/<[^>]*>/g, "")).trim().length > 0;
    if (!accessible) {
      violations.push(v("button-name", "error", "WCAG 4.1.2",
        "Button has no accessible text. Screen readers will announce it as an unnamed button, making it impossible for users to understand its purpose.",
        "https://dequeuniversity.com/rules/axe/4.9/button-name", truncate(fullTag, 200), buildSelector(fullTag)));
    } else {
      passCount++;
    }
  }

  // ── 12. Empty headings ──
  const emptyHRe = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  while ((match = emptyHRe.exec(cleanHtml)) !== null) {
    const openTag = match[0].match(/<h[^>]*/i)?.[0] || "";
    const text = decodeEntities(match[2].replace(/<[^>]*>/g, "")).trim();
    if (!/\baria-label\s*=\s*["'][^"']+["']/i.test(openTag) &&
        !/\baria-labelledby\s*=\s*["'][^"']+["']/i.test(openTag) &&
        text.length === 0) {
      violations.push(v("empty-heading", "error", "WCAG 1.3.1",
        `Heading level ${match[1]} (<h${match[1]}>) is empty. Empty headings disrupt screen reader navigation by creating dead landmarks.`,
        "https://dequeuniversity.com/rules/axe/4.9/empty-heading", truncate(match[0], 200), buildSelector(match[0])));
    }
  }

  // ── 13. Heading order ──
  const hLevelRe = /<h([1-6])\b[^>]*>/gi;
  const hLevels: number[] = [];
  while ((match = hLevelRe.exec(cleanHtml)) !== null) hLevels.push(parseInt(match[1]));
  for (let i = 1; i < hLevels.length; i++) {
    if (hLevels[i] > hLevels[i - 1] + 1) {
      violations.push(v("heading-order", "alert", "WCAG 1.3.1",
        `Heading jumps from h${hLevels[i - 1]} to h${hLevels[i]}. Heading levels must be sequential; skipped levels confuse screen reader navigation.`,
        "https://dequeuniversity.com/rules/axe/4.9/heading-order", `<h${hLevels[i]}>`, `h${hLevels[i]}`));
      break;
    }
  }

  // ── 14+15. Heading presence ──
  const hasH = /<h[1-6]\b/i.test(cleanHtml);
  if (!hasH) {
    violations.push(v("heading-missing", "alert", "WCAG 1.3.1",
      "Page has no heading elements (<h1>–<h6>). Headings allow screen reader users to navigate and understand page structure quickly.",
      "https://webaim.org/techniques/semanticstructure/#headings", "<body>", "body"));
  } else {
    passCount++;
    if (!/<h1\b/i.test(cleanHtml)) {
      violations.push(v("heading-first-missing", "alert", "WCAG 1.3.1",
        "Page has headings but no <h1> element. Every page should have a top-level heading that describes its main topic.",
        "https://dequeuniversity.com/rules/axe/4.9/page-has-heading-one", "<body>", "body"));
    } else {
      passCount++;
    }
  }

  // ── 16. Iframes without title ──
  const iframeRe = /<iframe\b[^>]*>/gi;
  while ((match = iframeRe.exec(cleanHtml)) !== null) {
    const tag = match[0];
    if (!/\btitle\s*=\s*["'][^"']+["']/i.test(tag) &&
        !/\baria-label\s*=\s*["'][^"']+["']/i.test(tag) &&
        !/\baria-labelledby\s*=\s*["'][^"']+["']/i.test(tag)) {
      violations.push(v("frame-title", "error", "WCAG 4.1.2",
        "Iframe does not have a title attribute. Screen readers cannot identify the purpose of this embedded frame.",
        "https://dequeuniversity.com/rules/axe/4.9/frame-title", truncate(tag, 200), buildSelector(tag)));
    }
  }

  // ── 17. Broken ARIA references — uses pre-compiled regexes ──
  const ariaRefRe = /<[^/][^>]*\b(?:aria-labelledby|aria-describedby|aria-controls|aria-owns)\s*=\s*["']([^"']+)["'][^>]*>/gi;
  while ((match = ariaRefRe.exec(cleanHtml)) !== null) {
    const tag = match[0];
    for (const [attr, attrRe] of ARIA_REF_RES) {
      const am = attrRe.exec(tag);
      if (am) {
        for (const refId of am[1].trim().split(/\s+/)) {
          if (refId && !allIds.has(refId)) {
            violations.push(v("aria-reference-broken", "error", "WCAG 4.1.2",
              `${attr}="${am[1]}" references id="${refId}" which does not exist on this page. Broken ARIA references cause screen readers to fail silently.`,
              "https://dequeuniversity.com/rules/axe/4.9/aria-valid-attr-value", truncate(tag, 200), buildSelector(tag)));
            break;
          }
        }
      }
    }
  }

  // ── 18. role=presentation on focusable ──
  const rolePresentRe = /<(?!\/)[a-z][^>]*\brole\s*=\s*["'](?:presentation|none)["'][^>]*>/gi;
  while ((match = rolePresentRe.exec(cleanHtml)) !== null) {
    const tag = match[0];
    const tm = /\btabindex\s*=\s*["']?(-?\d+)["']?/i.exec(tag);
    if (tm && parseInt(tm[1]) >= 0) {
      violations.push(v("role-presentation", "error", "WCAG 4.1.2",
        'Element with role="presentation" is keyboard-focusable. This creates an invisible, confusing tab stop for keyboard and screen reader users.',
        "https://dequeuniversity.com/rules/axe/4.9/role-presentation", truncate(tag, 200), buildSelector(tag)));
    }
  }

  // ── 19. aria-hidden on focusable ──
  const ariaHidRe = /<(?!\/)[a-z][^>]*\baria-hidden\s*=\s*["']true["'][^>]*>/gi;
  while ((match = ariaHidRe.exec(cleanHtml)) !== null) {
    const tag = match[0];
    const tm = /\btabindex\s*=\s*["']?(-?\d+)["']?/i.exec(tag);
    if (tm && parseInt(tm[1]) >= 0) {
      violations.push(v("aria-hidden-focus", "error", "WCAG 4.1.2",
        'Element with aria-hidden="true" is keyboard-focusable. Keyboard users reach it, but screen readers ignore it — the element disappears mid-navigation.',
        "https://dequeuniversity.com/rules/axe/4.9/aria-hidden-focus", truncate(tag, 200), buildSelector(tag)));
    }
  }

  // ── 20. Duplicate IDs ──
  const idCountRe = /\bid\s*=\s*["']([^"']+)["']/gi;
  const idCounts: Record<string, number> = {};
  while ((match = idCountRe.exec(cleanHtml)) !== null) {
    idCounts[match[1]] = (idCounts[match[1]] || 0) + 1;
  }
  for (const [id, count] of Object.entries(idCounts)) {
    if (count > 1 && referencedIds.has(id)) {
      violations.push(v("duplicate-id", "error", "WCAG 4.1.1",
        `id="${id}" appears ${count} times. IDs must be unique; duplicate IDs break label associations, ARIA references, and anchor navigation.`,
        "https://dequeuniversity.com/rules/axe/4.9/duplicate-id", `id="${id}"`, `#${cssEscape(id)}`));
    }
  }

  // ── 21+22. Media autoplay ──
  if (/<video\b[^>]*\bautoplay\b/i.test(cleanHtml) && !/<video\b[^>]*\bcontrols\b/i.test(cleanHtml)) {
    violations.push(v("video-autoplay", "alert", "WCAG 1.4.2",
      "Video autoplays without providing controls. Users should be able to pause, stop, or mute auto-playing media.",
      "https://www.w3.org/WAI/WCAG21/Understanding/audio-control.html", "video", "video"));
  }
  if (/<audio\b[^>]*\bautoplay\b/i.test(cleanHtml) && !/<audio\b[^>]*\bcontrols\b/i.test(cleanHtml)) {
    violations.push(v("audio-autoplay", "alert", "WCAG 1.4.2",
      "Audio autoplays without providing controls. Users should be able to pause, stop, or mute auto-playing media.",
      "https://www.w3.org/WAI/WCAG21/Understanding/audio-control.html", "audio", "audio"));
  }

  // ── 23+24. Blink + Marquee ──
  if (/<blink\b/i.test(cleanHtml)) {
    const bt = /<blink\b[^>]*>/i.exec(cleanHtml);
    violations.push(v("blink", "error", "WCAG 2.2.2",
      "A <blink> element is present. Blinking content cannot be paused and may trigger seizures in users with photosensitive epilepsy.",
      "https://www.w3.org/TR/WCAG21/#pause-stop-hide", bt ? truncate(bt[0], 200) : "<blink>", "blink"));
  }
  if (/<marquee\b/i.test(cleanHtml)) {
    const mt = /<marquee\b[^>]*>/i.exec(cleanHtml);
    violations.push(v("marquee", "error", "WCAG 2.2.2",
      "A <marquee> element is present. Scrolling content cannot be paused by users, making it difficult or impossible to read for many disability groups.",
      "https://www.w3.org/TR/WCAG21/#pause-stop-hide", mt ? truncate(mt[0], 200) : "<marquee>", "marquee"));
  }

  // ── 26. Data tables without headers ──
  const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  while ((match = tableRe.exec(cleanHtml)) !== null) {
    const tableTag = match[0];
    if (/\brole\s*=\s*["'](?:presentation|none)["']/i.test(tableTag)) continue;
    if (/<th\b[^>]*>/i.test(match[1])) continue;
    if ((match[1].match(/<tr\b[^>]*>/gi) || []).length >= 2) {
      violations.push(v("table-fake", "error", "WCAG 1.3.1",
        "A data table has no header cells (<th>). Without headers, screen readers cannot identify what each column or row represents.",
        "https://dequeuniversity.com/rules/axe/4.9/table-fake", truncate(tableTag, 200), buildSelector(tableTag)));
    }
  }

  // ── 27. Meta viewport zoom disabled ──
  if (/<meta\b[^>]+\bviewport\b[^>]+\buser-scalable\s*=\s*["']?no["']?/i.test(cleanHtml) ||
      /<meta\b[^>]+\bviewport\b[^>]+\bmaximum-scale\s*=\s*["']?1(?:\.0)?["']?/i.test(cleanHtml)) {
    violations.push(v("meta-viewport", "error", "WCAG 1.4.4",
      "Viewport meta tag prevents users from scaling the page. Users with low vision must be able to zoom to 200% without loss of content.",
      "https://dequeuniversity.com/rules/axe/4.9/meta-viewport", '<meta name="viewport">', "meta[name=viewport]"));
  }

  // ── 28. Meta refresh ──
  const mrMatch = /<meta\b[^>]+\bhttp-equiv\s*=\s*["']refresh["'][^>]*>/i.exec(cleanHtml);
  if (mrMatch) {
    const cv = /\bcontent\s*=\s*["'](\d+)/i.exec(mrMatch[0]);
    const delay = cv ? parseInt(cv[1]) : 0;
    violations.push(v("meta-refresh", "alert", "WCAG 2.2.1",
      delay === 0
        ? "Page uses an instant meta refresh/redirect. This can disorient screen reader users who are mid-way through reading content."
        : `Page auto-refreshes after ${delay} seconds. Auto-refreshing pages interrupt reading and cause loss of keyboard focus.`,
      "https://dequeuniversity.com/rules/axe/4.9/meta-refresh", truncate(mrMatch[0], 200), "meta[http-equiv=refresh]"));
  }

  // ── Structural pass bonuses ──
  if (/<main\b/i.test(cleanHtml) || /\brole\s*=\s*["']main["']/i.test(cleanHtml)) passCount++;
  if (/<nav\b/i.test(cleanHtml) || /\brole\s*=\s*["']navigation["']/i.test(cleanHtml)) passCount++;
  if (/<header\b/i.test(cleanHtml)) passCount++;
  if (/<footer\b/i.test(cleanHtml)) passCount++;
  if (/href\s*=\s*["']#(?:main|content|skip|maincontent)[^"']*["']/i.test(cleanHtml)) passCount++;
  if (/<meta[^>]+charset/i.test(cleanHtml)) passCount++;
  if (/<meta[^>]+viewport/i.test(cleanHtml)) passCount++;
  if (/<(?:ul|ol)\b/i.test(cleanHtml)) passCount++;
  if (/<caption\b/i.test(cleanHtml)) passCount++;
  if (/<fieldset\b/i.test(cleanHtml) && /<legend\b/i.test(cleanHtml)) passCount++;
  if (/\baria-live\s*=\s*["'](?:polite|assertive)["']/i.test(cleanHtml)) passCount++;

  return { violations, passCount };
}

// ─── Scoring ───

function calculatePageScore(violations: Violation[], passCount: number): number {
  const w: Record<string, number> = { error: 8, alert: 2 };
  const deduction = violations.reduce((s, v) => s + (w[v.impact] || 1), 0);
  return Math.max(0, Math.min(100, Math.round(100 - deduction + Math.min(passCount * 0.5, 10))));
}

function calculateOverallScore(violations: { impact: string }[], totalPages: number): number {
  if (totalPages === 0) return 0;
  const w: Record<string, number> = { error: 10, alert: 3 };
  return Math.max(0, Math.round(100 - violations.reduce((s, v) => s + (w[v.impact] || 1), 0)));
}

// ─── Helpers ───

function truncate(str: string, maxLen: number): string {
  return str.length <= maxLen ? str : str.slice(0, maxLen - 3) + "...";
}

function buildSelector(tag: string): string {
  const id = tag.match(/id\s*=\s*["']([^"']+)["']/i);
  if (id) return `#${id[1]}`;
  const cls = tag.match(/class\s*=\s*["']([^"']+)["']/i);
  if (cls) return `.${cls[1].split(/\s+/)[0]}`;
  const tn = tag.match(/<(\w+)/);
  return tn ? tn[1].toLowerCase() : "unknown";
}

function cssEscape(str: string): string {
  return str.replace(/([^\w-])/g, "\\$1");
}
