import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// WAVE Errors only — restricted to aria-labelledby and aria-describedby (WAVE Error rule)
const ARIA_REF_RES: Array<[string, RegExp]> = [
  ["aria-labelledby", /\baria-labelledby\s*=\s*["']([^"']+)["']/i],
  ["aria-describedby", /\baria-describedby\s*=\s*["']([^"']+)["']/i],
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
  "image-alt":             "Missing image alternative text",
  "image-alt-empty-link":  "Linked image missing alternative text",
  "input-image-alt":       "Image button missing alternative text",
  "html-lang-valid":       "Missing or invalid page language",
  "document-title":        "Missing or empty page title",
  "label":                 "Missing form label",
  "label-empty":           "Empty form label",
  "multiple-labels":       "Multiple form labels",
  "button-name":           "Empty button",
  "link-name":             "Empty link",
  "empty-heading":         "Empty heading",
  "th-empty":              "Empty table header",
  "aria-reference-broken": "Broken ARIA reference",
  "skip-link-broken":      "Broken skip link",
  "duplicate-id":          "Duplicate ID",
};

function v(
  ruleId: string, impact: string, category: string,
  description: string, helpUrl: string, element: string, selector: string
): Violation {
  return { impact, category, ruleId, title: VIOLATION_TITLES[ruleId] || "Accessibility issue",
    description, helpUrl, element, selector };
}

// Single-pass analysis — only WAVE Error-category violations.
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

  // Pre-compute label for= targets and counts
  const labelForIds = new Set<string>();
  const labelForCounts: Record<string, number> = {};
  const labelForRe = /<label\b[^>]*\bfor\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let lfm: RegExpExecArray | null;
  while ((lfm = labelForRe.exec(cleanHtml)) !== null) {
    labelForIds.add(lfm[1]);
    labelForCounts[lfm[1]] = (labelForCounts[lfm[1]] || 0) + 1;
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

  // ── 1. Images: missing alt ──
  const imgRe = /<img\b[^>]*>/gi;
  while ((match = imgRe.exec(cleanHtml)) !== null) {
    const tag = match[0];
    if (inNoscript(match.index)) continue;
    if (/\brole\s*=\s*["'](?:presentation|none)["']/i.test(tag)) continue;
    if (!/\balt\s*=/i.test(tag)) {
      violations.push(v("image-alt", "serious", "WCAG 1.1.1",
        "Image is missing an alt attribute. Screen readers cannot convey the image's content or purpose to non-sighted users.",
        "https://wave.webaim.org/api/references#e_alt_missing", truncate(tag, 2000), buildSelector(tag)));
    } else if (/\balt\s*=\s*["'][^"']+["']/i.test(tag)) {
      passCount++;
    }
  }

  // ── 2. Links: linked-image alt + empty link ──
  const linkRe = /<a\b[^>]*\bhref\b[^>]*>([\s\S]*?)<\/a>/gi;
  while ((match = linkRe.exec(cleanHtml)) !== null) {
    const fullTag = match[0];
    const openTag = fullTag.match(/<a[^>]*/i)?.[0] || "";
    const inner = match[1];
    if (inNoscript(match.index)) continue;

    const hasAL     = /\baria-label\s*=\s*["'][^"']+["']/i.test(openTag);
    const hasALB    = /\baria-labelledby\s*=\s*["'][^"']+["']/i.test(openTag);
    const hasT      = /\btitle\s*=\s*["'][^"']+["']/i.test(openTag);
    const hasImgAlt = /<img[^>]+\balt\s*=\s*["'][^"']+["']/i.test(inner);
    const hasSvg    = /<svg[^>]+\baria-label\s*=\s*["'][^"']+["']/i.test(inner) ||
                      (/<svg\b/i.test(inner) && /<title\b[^>]*>[^<]+<\/title>/i.test(inner));
    const text = decodeEntities(inner.replace(/<[^>]*>/g, "")).trim();

    // Linked image missing alt (WAVE: image_alt_missing on linked image)
    if (/<img\b/i.test(inner) && !hasImgAlt && !hasAL && !hasALB && !hasT && text.length === 0) {
      violations.push(v("image-alt-empty-link", "serious", "WCAG 1.1.1",
        "A linked image has an empty or missing alt attribute and the link has no other accessible text. Screen readers cannot determine the link's purpose.",
        "https://wave.webaim.org/api/references#e_alt_link_missing", truncate(fullTag, 2000), buildSelector(fullTag)));
    }

    // Empty link (WAVE: link_empty)
    if (!/\baria-hidden\s*=\s*["']true["']/i.test(openTag)) {
      const accessible = hasAL || hasALB || hasT || hasImgAlt || hasSvg || text.length > 0;
      if (!accessible) {
        violations.push(v("link-name", "serious", "WCAG 4.1.2",
          "Link has no accessible text. Screen readers cannot convey this link's purpose to the user.",
          "https://wave.webaim.org/api/references#e_link_empty", truncate(fullTag, 2000), buildSelector(fullTag)));
      } else {
        passCount++;
      }
    }
  }

  // ── 3. HTML lang (WAVE: language_missing) ──
  const htmlTag = cleanHtml.match(/<html\b[^>]*>/i);
  if (htmlTag && !/\blang\s*=/i.test(htmlTag[0])) {
    violations.push(v("html-lang-valid", "serious", "WCAG 3.1.1",
      "The <html> element does not have a lang attribute. Screen readers use this to select the correct voice and pronunciation engine.",
      "https://wave.webaim.org/api/references#e_lang_missing", "<html>", "html"));
  } else if (htmlTag) {
    passCount++;
  }

  // ── 4. Document title (WAVE: title_missing) ──
  const titleMatch = cleanHtml.match(/<title\b[^>]*>([^<]*)<\/title>/i);
  if (!titleMatch || titleMatch[1].trim().length === 0) {
    violations.push(v("document-title", "serious", "WCAG 2.4.2",
      "Document does not have a meaningful <title> element. Page titles identify each page in browser history, bookmarks, and screen reader announcements.",
      "https://wave.webaim.org/api/references#e_title_missing", "<title>", "head > title"));
  } else {
    passCount++;
  }

  // ── 5. Form labels: missing (WAVE: label_missing) ──
  const inputRe = /<input\b[^>]*>/gi;
  while ((match = inputRe.exec(cleanHtml)) !== null) {
    const tag = match[0];
    if (inNoscript(match.index)) continue;
    const tm = /\btype\s*=\s*["']([^"']+)["']/i.exec(tag);
    const inputType = tm ? tm[1].toLowerCase() : "text";
    if (inputType === "image") {
      if (!/\balt\s*=\s*["'][^"']*["']/i.test(tag)) {
        violations.push(v("input-image-alt", "serious", "WCAG 1.1.1",
          "Image input button is missing an alt attribute. Screen readers cannot identify this button's purpose.",
          "https://wave.webaim.org/api/references#e_alt_input_missing", truncate(tag, 2000), buildSelector(tag)));
      }
      continue;
    }
    if (["hidden", "submit", "reset", "button"].includes(inputType)) continue;
    if (controlHasLabel(tag, match.index)) {
      passCount++;
    } else {
      violations.push(v("label", "serious", "WCAG 1.3.1",
        "Form input does not have an associated label. Users relying on screen readers or voice control cannot determine what information to enter.",
        "https://wave.webaim.org/api/references#e_label_missing", truncate(tag, 2000), buildSelector(tag)));
    }
  }

  const selectRe = /<select\b[^>]*>/gi;
  while ((match = selectRe.exec(cleanHtml)) !== null) {
    const tag = match[0];
    if (inNoscript(match.index)) continue;
    if (!controlHasLabel(tag, match.index)) {
      violations.push(v("label", "serious", "WCAG 1.3.1",
        "Select (dropdown) element does not have an associated label. Screen reader users cannot identify the purpose of this control.",
        "https://wave.webaim.org/api/references#e_label_missing", truncate(tag, 2000), buildSelector(tag)));
    }
  }

  const textareaRe = /<textarea\b[^>]*>/gi;
  while ((match = textareaRe.exec(cleanHtml)) !== null) {
    const tag = match[0];
    if (inNoscript(match.index)) continue;
    if (!controlHasLabel(tag, match.index)) {
      violations.push(v("label", "serious", "WCAG 1.3.1",
        "Textarea element does not have an associated label.",
        "https://wave.webaim.org/api/references#e_label_missing", truncate(tag, 2000), buildSelector(tag)));
    }
  }

  // ── 6. Empty labels (WAVE: label_empty) ──
  const labelFullRe = /<label\b[^>]*>([\s\S]*?)<\/label>/gi;
  while ((match = labelFullRe.exec(cleanHtml)) !== null) {
    const inner = match[1];
    const text = decodeEntities(inner.replace(/<[^>]*>/g, "")).trim();
    if (text.length === 0 && !/<img[^>]+\balt\s*=\s*["'][^"']+["']/i.test(inner)) {
      violations.push(v("label-empty", "serious", "WCAG 1.3.1",
        "A <label> element exists but is empty. An empty label provides no information to screen reader users about the associated form control.",
        "https://wave.webaim.org/api/references#e_label_empty", truncate(match[0], 2000), "label"));
    }
  }

  // ── 7. Multiple labels (WAVE: label_multiple) ──
  for (const [forId, count] of Object.entries(labelForCounts)) {
    if (count > 1) {
      violations.push(v("multiple-labels", "serious", "WCAG 1.3.1",
        `Form control with id="${forId}" has ${count} associated <label> elements. Multiple labels create ambiguous instructions for screen reader users.`,
        "https://wave.webaim.org/api/references#e_label_multiple", `label[for="${forId}"]`, `[id="${forId}"]`));
    }
  }

  // ── 8. Buttons: empty (WAVE: button_empty) ──
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
      violations.push(v("button-name", "critical", "WCAG 4.1.2",
        "Button has no accessible text. Screen readers will announce it as an unnamed button, making it impossible for users to understand its purpose.",
        "https://wave.webaim.org/api/references#e_button_empty", truncate(fullTag, 2000), buildSelector(fullTag)));
    } else {
      passCount++;
    }
  }

  // ── 9. Empty headings (WAVE: heading_empty) ──
  const emptyHRe = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  while ((match = emptyHRe.exec(cleanHtml)) !== null) {
    const openTag = match[0].match(/<h[^>]*/i)?.[0] || "";
    const text = decodeEntities(match[2].replace(/<[^>]*>/g, "")).trim();
    if (!/\baria-label\s*=\s*["'][^"']+["']/i.test(openTag) &&
        !/\baria-labelledby\s*=\s*["'][^"']+["']/i.test(openTag) &&
        text.length === 0) {
      violations.push(v("empty-heading", "serious", "WCAG 1.3.1",
        `Heading level ${match[1]} (<h${match[1]}>) is empty. Empty headings disrupt screen reader navigation by creating dead landmarks.`,
        "https://wave.webaim.org/api/references#e_heading_empty", truncate(match[0], 2000), buildSelector(match[0])));
    }
  }

  // ── 10. Empty table headers (WAVE: th_empty) ──
  const thRe = /<th\b[^>]*>([\s\S]*?)<\/th>/gi;
  while ((match = thRe.exec(cleanHtml)) !== null) {
    const openTag = match[0].match(/<th[^>]*/i)?.[0] || "";
    const text = decodeEntities(match[1].replace(/<[^>]*>/g, "")).trim();
    if (text.length === 0 &&
        !/\baria-label\s*=\s*["'][^"']+["']/i.test(openTag) &&
        !/\babbr\s*=\s*["'][^"']+["']/i.test(openTag)) {
      violations.push(v("th-empty", "serious", "WCAG 1.3.1",
        "Table header cell (<th>) is empty. Empty headers provide no column or row information to screen reader users.",
        "https://wave.webaim.org/api/references#e_th_empty", truncate(match[0], 2000), buildSelector(match[0])));
    }
  }

  // ── 11. Broken ARIA references — aria-labelledby and aria-describedby only (WAVE: aria_reference_broken) ──
  const ariaRefRe = /<[^/][^>]*\b(?:aria-labelledby|aria-describedby)\s*=\s*["']([^"']+)["'][^>]*>/gi;
  while ((match = ariaRefRe.exec(cleanHtml)) !== null) {
    const tag = match[0];
    for (const [attr, attrRe] of ARIA_REF_RES) {
      const am = attrRe.exec(tag);
      if (am) {
        for (const refId of am[1].trim().split(/\s+/)) {
          if (refId && !allIds.has(refId)) {
            violations.push(v("aria-reference-broken", "critical", "WCAG 4.1.2",
              `${attr}="${am[1]}" references id="${refId}" which does not exist on this page. Broken ARIA references cause screen readers to fail silently.`,
              "https://wave.webaim.org/api/references#e_aria_reference_broken", truncate(tag, 2000), buildSelector(tag)));
            break;
          }
        }
      }
    }
  }

  // ── 12. Broken skip links (WAVE: skip_target_missing) ──
  const skipLinkRe = /<a\b[^>]*\bhref\s*=\s*["']#([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  while ((match = skipLinkRe.exec(cleanHtml)) !== null) {
    const targetId = match[1];
    const linkText = decodeEntities(match[2].replace(/<[^>]*>/g, "")).trim().toLowerCase();
    const isSkipLink = /skip|jump|bypass|main content|navigation/i.test(linkText) ||
                       match.index < 2000;
    if (isSkipLink && !allIds.has(targetId)) {
      violations.push(v("skip-link-broken", "serious", "WCAG 2.4.1",
        `Skip link points to "#${targetId}" which does not exist on this page. Users who rely on skip links to bypass navigation are stranded.`,
        "https://wave.webaim.org/api/references#e_skip_target_missing", truncate(match[0], 2000), `a[href="#${targetId}"]`));
    }
  }



  // ── Structural pass bonuses ──
  if (/<main\b/i.test(cleanHtml) || /\brole\s*=\s*["']main["']/i.test(cleanHtml)) passCount++;
  if (/<nav\b/i.test(cleanHtml) || /\brole\s*=\s*["']navigation["']/i.test(cleanHtml)) passCount++;
  if (/<header\b/i.test(cleanHtml)) passCount++;
  if (/<footer\b/i.test(cleanHtml)) passCount++;
  if (/href\s*=\s*["']#(?:main|content|skip|maincontent)[^"']*["']/i.test(cleanHtml)) passCount++;
  if (/<meta[^>]+charset/i.test(cleanHtml)) passCount++;
  if (/<(?:ul|ol)\b/i.test(cleanHtml)) passCount++;
  if (/<fieldset\b/i.test(cleanHtml) && /<legend\b/i.test(cleanHtml)) passCount++;

  return { violations, passCount };
}

// ─── Scoring ───

function calculatePageScore(violations: Violation[], passCount: number): number {
  const w: Record<string, number> = { critical: 12, serious: 6, moderate: 2, minor: 1 };
  const deduction = violations.reduce((s, v) => s + (w[v.impact] || 1), 0);
  return Math.max(0, Math.min(100, Math.round(100 - deduction + Math.min(passCount * 0.5, 10))));
}

function calculateOverallScore(violations: { impact: string }[], totalPages: number): number {
  if (totalPages === 0) return 0;
  const w: Record<string, number> = { critical: 15, serious: 8, moderate: 3, minor: 1 };
  return Math.max(0, Math.round(100 - violations.reduce((s, v) => s + (w[v.impact] || 1), 0)));
}

// ─── Helpers ───

function truncate(str: string, maxLen: number): string {
  return str.length <= maxLen ? str : str.slice(0, maxLen - 3) + "...";
}

function cssEscape(str: string): string {
  return str.replace(/([^\w-])/g, "\\$1");
}

function getAttr(tag: string, attr: string): string | null {
  const m = tag.match(new RegExp(`\\b${attr}\\s*=\\s*["']([^"']*)["']`, "i"));
  return m ? m[1] : null;
}

function buildSelector(tag: string): string {
  const tagNameMatch = tag.match(/<(\w+)/);
  const tagName = tagNameMatch ? tagNameMatch[1].toLowerCase() : "unknown";

  // 1. ID — always unique
  const id = getAttr(tag, "id");
  if (id) return `#${cssEscape(id)}`;

  // 2. Build a compound selector using distinguishing attributes
  const parts: string[] = [tagName];

  // type is critical for inputs (text, email, checkbox, radio, etc.)
  const type = getAttr(tag, "type");
  if (type) parts.push(`[type="${type}"]`);

  // name uniquely identifies form controls in most forms
  const name = getAttr(tag, "name");
  if (name) parts.push(`[name="${name}"]`);

  // href identifies specific links (including skip links)
  const href = getAttr(tag, "href");
  if (href) parts.push(`[href="${href}"]`);

  // for identifies labels associated with specific controls
  const forAttr = getAttr(tag, "for");
  if (forAttr) parts.push(`[for="${forAttr}"]`);

  // role distinguishes elements with ARIA roles
  const role = getAttr(tag, "role");
  if (role) parts.push(`[role="${role}"]`);

  // aria-label uniquely identifies elements in many cases
  const ariaLabel = getAttr(tag, "aria-label");
  if (ariaLabel) parts.push(`[aria-label="${ariaLabel}"]`);

  // placeholder distinguishes text inputs
  const placeholder = getAttr(tag, "placeholder");
  if (placeholder) parts.push(`[placeholder="${placeholder}"]`);

  // title provides accessible name
  const title = getAttr(tag, "title");
  if (title) parts.push(`[title="${title}"]`);

  // value distinguishes buttons/inputs
  const value = getAttr(tag, "value");
  if (value && (tagName === "input" || tagName === "button")) parts.push(`[value="${value}"]`);

  // src identifies images
  const src = getAttr(tag, "src");
  if (src && (tagName === "img" || tagName === "input")) parts.push(`[src="${src}"]`);

  // If we have at least one distinguishing attribute, return the compound selector
  if (parts.length > 1) return parts.join("");

  // 3. Fall back to first class
  const cls = getAttr(tag, "class");
  if (cls) return `.${cssEscape(cls.split(/\s+/)[0])}`;

  // 4. Last resort: tag name only
  return tagName;
}
