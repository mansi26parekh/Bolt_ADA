import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

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

    // GET /ada-scan/:id - Get scan status and results
    if (req.method === "GET" && path.startsWith("/") && path.length > 1) {
      const scanId = path.slice(1);
      const { data: scan, error: scanError } = await supabase
        .from("scans")
        .select("*")
        .eq("id", scanId)
        .maybeSingle();

      if (scanError || !scan) {
        return new Response(JSON.stringify({ error: "Scan not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: pages } = await supabase
        .from("scan_pages")
        .select("*")
        .eq("scan_id", scanId)
        .order("created_at", { ascending: true });

      const { data: results } = await supabase
        .from("scan_results")
        .select("*")
        .eq("scan_id", scanId)
        .order("created_at", { ascending: true });

      return new Response(
        JSON.stringify({ scan, pages: pages || [], results: results || [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // POST /ada-scan - Start a new scan
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
        .insert({
          url: targetUrl,
          status: "running",
          max_depth: maxDepth,
          total_pages: 0,
          pages_scanned: 0,
        })
        .select()
        .single();

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

// Fetch up to this many pages simultaneously
const CONCURRENCY = 5;
// Skip binary/asset URLs immediately
const NON_HTML_RE = /\.(pdf|jpg|jpeg|png|gif|svg|css|js|ico|woff2?|ttf|eot|mp4|mp3|zip|docx?|xlsx?|pptx?)$/i;
// Tracking query params that don't change page content
const TRACKING_PARAMS = ["utm_source","utm_medium","utm_campaign","utm_content","utm_term","ref","fbclid","gclid","source","affiliate","tracking"];

function dedupeUrl(raw: string, base: string): string | null {
  const norm = normalizeUrl(raw, base);
  if (!norm) return null;
  try {
    const u = new URL(norm);
    for (const p of TRACKING_PARAMS) u.searchParams.delete(p);
    let s = u.toString();
    if (s.endsWith("/") && s.length > new URL(base).origin.length + 1) s = s.slice(0, -1);
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
  let pagesQueued = 0;   // how many pages we've dequeued and started
  let pagesScanned = 0;  // how many pages completed without error

  const root = dedupeUrl(rootUrl, rootUrl);
  if (!root) {
    await supabase.from("scans").update({ status: "failed", completed_at: new Date().toISOString() }).eq("id", scanId);
    return;
  }
  visited.add(root);
  queue.push({ url: root, depth: 0 });

  // ── Per-page worker: fetch → discover links → analyze → write DB ──
  const processPage = async (url: string, depth: number) => {
    // Insert the page record early so the UI shows it immediately
    const { data: pageRecord } = await supabase
      .from("scan_pages")
      .insert({ scan_id: scanId, url, depth, status: "running", title: null })
      .select("id")
      .single();

    // Fetch the page HTML
    let pageData: { html: string; title: string; links: string[] };
    try {
      pageData = await fetchPage(url);
    } catch (err) {
      console.error(`Fetch failed: ${url}`, err);
      if (pageRecord) {
        await supabase.from("scan_pages")
          .update({ status: "failed", completed_at: new Date().toISOString() })
          .eq("id", pageRecord.id);
      }
      return;
    }

    // Discover and enqueue new links immediately — so other workers can start on them
    // while this worker is still doing analysis + DB writes
    for (const link of pageData.links) {
      const norm = dedupeUrl(link, rootUrl);
      if (
        norm &&
        !visited.has(norm) &&
        isSameDomain(norm, rootUrl) &&
        depth + 1 <= maxDepth &&
        !NON_HTML_RE.test(norm) &&
        visited.size < maxPages
      ) {
        visited.add(norm);
        queue.push({ url: norm, depth: depth + 1 });
      }
    }

    if (!pageRecord) return;

    // Accessibility analysis (CPU-bound, synchronous, fast)
    const cleanHtml = pageData.html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "");
    const analysis = analyzeAccessibility(pageData.html, url, cleanHtml);
    const passCount = countPasses(cleanHtml);
    const pageScore = calculatePageScore(analysis, passCount);

    // Build result rows
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

    // Fire all DB writes in parallel: page update + all result batches at once
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

    // Accumulate totals (safe — JS event loop is single-threaded between awaits)
    allViolations.push(...analysis.map((v) => ({ impact: v.impact })));
    totalPasses += passCount;
    pagesScanned++;

    // Throttled progress counter: write to DB every 5 pages (not every 1)
    if (pagesScanned % 5 === 0) {
      supabase.from("scans").update({ pages_scanned: pagesScanned }).eq("id", scanId).then(() => {});
    }
  };

  // ── Worker pool driver ──
  // Keeps up to CONCURRENCY workers running simultaneously.
  // As each worker finishes it may have added new URLs to `queue`,
  // so we immediately try to spawn replacements.
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
    trySpawn(); // refill pool after each completion
  }

  // Final scan record update
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

// ─── URL utilities ───

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

function isSameDomain(url: string, baseUrl: string): boolean {
  try {
    return new URL(url).hostname === new URL(baseUrl).hostname;
  } catch {
    return false;
  }
}

// ─── Page fetching ───

async function fetchPage(url: string): Promise<{
  html: string;
  title: string;
  links: string[];
}> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

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

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
    throw new Error(`Non-HTML content type: ${contentType}`);
  }

  const html = await response.text();

  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1].trim()) : new URL(url).pathname;

  const linkRegex = /<a[^>]+href\s*=\s*["']([^"']+)["']/gi;
  const links: string[] = [];
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    links.push(match[1]);
  }

  return { html, title, links };
}

function decodeEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ");
}

// ─── Accessibility analysis ───
// Server-side static HTML analysis modelled after WAVE (WebAIM).
// Checks are grouped to match WAVE error and alert categories.

interface Violation {
  impact: string;
  category: string;
  ruleId: string;
  title: string;
  description: string;
  helpUrl: string;
  element: string;
  selector: string;
}

// Maps rule IDs to display titles (mirrors WAVE error/alert names)
const VIOLATION_TITLES: Record<string, string> = {
  // WAVE Errors → serious / critical
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

function createViolation(
  ruleId: string,
  impact: string,
  category: string,
  description: string,
  helpUrl: string,
  element: string,
  selector: string
): Violation {
  return {
    impact,
    category,
    ruleId,
    title: VIOLATION_TITLES[ruleId] || "Accessibility issue",
    description,
    helpUrl,
    element,
    selector,
  };
}

function analyzeAccessibility(html: string, _pageUrl: string, preClean?: string): Violation[] {
  const violations: Violation[] = [];

  const cleanHtml = preClean ?? html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  // Pre-compute noscript ranges once — avoids O(n) substring + regex per element
  const noscriptRanges: Array<[number, number]> = [];
  const _nscriptRe = /<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi;
  let _nsm: RegExpExecArray | null;
  while ((_nsm = _nscriptRe.exec(cleanHtml)) !== null) {
    noscriptRanges.push([_nsm.index, _nsm.index + _nsm[0].length]);
  }
  const inNoscript = (pos: number) => noscriptRanges.some(([s, e]) => pos >= s && pos <= e);

  // Pre-compute all document IDs for ARIA reference validation
  const allIds = new Set<string>();
  const allIdScanRegex = /\bid\s*=\s*["']([^"']+)["']/gi;
  let allIdMatch: RegExpExecArray | null;
  while ((allIdMatch = allIdScanRegex.exec(cleanHtml)) !== null) {
    allIds.add(allIdMatch[1]);
  }

  // Pre-compute positions of inputs that are implicitly labelled (inside <label>)
  const implicitLabeledPositions = new Set<number>();
  const labelBlockRegex = /<label\b[^>]*>[\s\S]*?<\/label>/gi;
  let lbm: RegExpExecArray | null;
  while ((lbm = labelBlockRegex.exec(cleanHtml)) !== null) {
    const blockOffset = lbm.index;
    const blockContent = lbm[0];
    const innerRegex = /<(?:input|select|textarea)\b[^>]*>/gi;
    let im: RegExpExecArray | null;
    while ((im = innerRegex.exec(blockContent)) !== null) {
      implicitLabeledPositions.add(blockOffset + im.index);
    }
  }

  // Pre-compute label for= targets — avoids compiling a new regex per form control
  const labelForIds = new Set<string>();
  const _labelForRe = /<label\b[^>]*\bfor\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let _lfm: RegExpExecArray | null;
  while ((_lfm = _labelForRe.exec(cleanHtml)) !== null) {
    labelForIds.add(_lfm[1]);
  }

  let match: RegExpExecArray | null;

  // Helper: determine if a form control has any accessible label
  function controlHasLabel(tag: string, matchIndex: number): boolean {
    if (implicitLabeledPositions.has(matchIndex)) return true;
    if (/\baria-label\s*=\s*["'][^"']+["']/i.test(tag)) return true;
    if (/\baria-labelledby\s*=\s*["'][^"']+["']/i.test(tag)) return true;
    if (/\btitle\s*=\s*["'][^"']+["']/i.test(tag)) return true;
    const idMatch = /\bid\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (idMatch && labelForIds.has(idMatch[1])) return true;
    return false;
  }

  // ── WAVE ERRORS ──────────────────────────────────────────────────────────

  // 1. Images missing alt attribute (WAVE: alt_missing)
  const imgRegex = /<img\b[^>]*>/gi;
  while ((match = imgRegex.exec(cleanHtml)) !== null) {
    const imgTag = match[0];
    if (inNoscript(match.index)) continue;
    if (/\brole\s*=\s*["'](?:presentation|none)["']/i.test(imgTag)) continue;
    if (!/\balt\s*=/i.test(imgTag)) {
      violations.push(createViolation(
        "image-alt",
        "serious",
        "WCAG 1.1.1",
        "Image is missing an alt attribute. Screen readers cannot convey the image's content or purpose to non-sighted users.",
        "https://dequeuniversity.com/rules/axe/4.9/image-alt",
        truncate(imgTag, 200),
        buildSelector(imgTag)
      ));
    }
  }

  // 2. Linked image with empty alt and no other accessible text (WAVE: alt_link_missing)
  const linkedImgRegex = /<a\b[^>]*\bhref\b[^>]*>([\s\S]*?)<\/a>/gi;
  while ((match = linkedImgRegex.exec(cleanHtml)) !== null) {
    const fullTag = match[0];
    const openTag = fullTag.match(/<a[^>]*/i)?.[0] || "";
    const innerContent = match[1];
    if (inNoscript(match.index)) continue;
    if (/\baria-label\s*=\s*["'][^"']+["']/i.test(openTag)) continue;
    if (/\baria-labelledby\s*=\s*["'][^"']+["']/i.test(openTag)) continue;
    if (/\btitle\s*=\s*["'][^"']+["']/i.test(openTag)) continue;
    // Link contains an image with empty or missing alt
    const hasImg = /<img\b/i.test(innerContent);
    if (!hasImg) continue;
    const imgWithMeaningfulAlt = /<img[^>]+\balt\s*=\s*["'][^"']+["']/i.test(innerContent);
    if (imgWithMeaningfulAlt) continue;
    // Check if there is other text content
    const textContent = decodeEntities(innerContent.replace(/<[^>]*>/g, "")).trim();
    if (textContent.length === 0) {
      violations.push(createViolation(
        "image-alt-empty-link",
        "serious",
        "WCAG 1.1.1",
        "A linked image has an empty or missing alt attribute and the link contains no other text. Screen readers cannot determine the link's purpose.",
        "https://dequeuniversity.com/rules/axe/4.9/image-alt",
        truncate(fullTag, 200),
        buildSelector(fullTag)
      ));
    }
  }

  // 3. Missing lang on <html> (WAVE: language_missing)
  const htmlTag = cleanHtml.match(/<html\b[^>]*>/i);
  if (htmlTag && !/\blang\s*=/i.test(htmlTag[0])) {
    violations.push(createViolation(
      "html-lang-valid",
      "serious",
      "WCAG 3.1.1",
      "The <html> element does not have a lang attribute. Screen readers use this to select the correct voice and pronunciation engine.",
      "https://dequeuniversity.com/rules/axe/4.9/html-lang-valid",
      "<html>",
      "html"
    ));
  }

  // 4. Missing or empty document title (WAVE: title_invalid)
  const titleMatch = cleanHtml.match(/<title\b[^>]*>([^<]*)<\/title>/i);
  if (!titleMatch || titleMatch[1].trim().length === 0) {
    violations.push(createViolation(
      "document-title",
      "serious",
      "WCAG 2.4.2",
      "Document does not have a meaningful <title> element. Page titles identify each page in browser history, bookmarks, and screen reader announcements.",
      "https://dequeuniversity.com/rules/axe/4.9/document-title",
      "<title>",
      "head > title"
    ));
  }

  // 5. Form inputs without labels (WAVE: label_missing)
  const inputRegex = /<input\b[^>]*>/gi;
  while ((match = inputRegex.exec(cleanHtml)) !== null) {
    const inputTag = match[0];
    if (inNoscript(match.index)) continue;
    const typeMatch = /\btype\s*=\s*["']([^"']+)["']/i.exec(inputTag);
    const inputType = typeMatch ? typeMatch[1].toLowerCase() : "text";

    if (inputType === "image") {
      if (!/\balt\s*=\s*["'][^"']*["']/i.test(inputTag)) {
        violations.push(createViolation(
          "input-image-alt",
          "serious",
          "WCAG 1.1.1",
          "Image input button is missing an alt attribute. Screen readers cannot identify this button's purpose.",
          "https://dequeuniversity.com/rules/axe/4.9/input-image-alt",
          truncate(inputTag, 200),
          buildSelector(inputTag)
        ));
      }
      continue;
    }

    if (["hidden", "submit", "reset", "button"].includes(inputType)) continue;

    if (!controlHasLabel(inputTag, match.index)) {
      violations.push(createViolation(
        "label",
        "serious",
        "WCAG 1.3.1",
        "Form input does not have an associated label. Users relying on screen readers or voice control cannot determine what information to enter.",
        "https://dequeuniversity.com/rules/axe/4.9/label",
        truncate(inputTag, 200),
        buildSelector(inputTag)
      ));
    }
  }

  // 6. Select elements without labels (WAVE: select_missing_label)
  const selectRegex = /<select\b[^>]*>/gi;
  while ((match = selectRegex.exec(cleanHtml)) !== null) {
    const selectTag = match[0];
    if (inNoscript(match.index)) continue;
    if (!controlHasLabel(selectTag, match.index)) {
      violations.push(createViolation(
        "label",
        "serious",
        "WCAG 1.3.1",
        "Select (dropdown) element does not have an associated label. Screen reader users cannot identify the purpose of this control.",
        "https://dequeuniversity.com/rules/axe/4.9/label",
        truncate(selectTag, 200),
        buildSelector(selectTag)
      ));
    }
  }

  // 7. Textarea elements without labels
  const textareaRegex = /<textarea\b[^>]*>/gi;
  while ((match = textareaRegex.exec(cleanHtml)) !== null) {
    const textareaTag = match[0];
    if (inNoscript(match.index)) continue;
    if (!controlHasLabel(textareaTag, match.index)) {
      violations.push(createViolation(
        "label",
        "serious",
        "WCAG 1.3.1",
        "Textarea element does not have an associated label.",
        "https://dequeuniversity.com/rules/axe/4.9/label",
        truncate(textareaTag, 200),
        buildSelector(textareaTag)
      ));
    }
  }

  // 8. Empty label elements (WAVE: label_empty)
  const labelFullRegex = /<label\b[^>]*>([\s\S]*?)<\/label>/gi;
  while ((match = labelFullRegex.exec(cleanHtml)) !== null) {
    const fullLabel = match[0];
    const innerContent = match[1];
    const textContent = decodeEntities(innerContent.replace(/<[^>]*>/g, "")).trim();
    // A label with an image that has alt text is acceptable
    if (textContent.length === 0 && !/<img[^>]+\balt\s*=\s*["'][^"']+["']/i.test(innerContent)) {
      violations.push(createViolation(
        "label-empty",
        "serious",
        "WCAG 1.3.1",
        "A <label> element exists but is empty. An empty label provides no information to screen reader users about the associated form control.",
        "https://dequeuniversity.com/rules/axe/4.9/label",
        truncate(fullLabel, 200),
        "label"
      ));
    }
  }

  // 9. Orphaned labels — for= points to a non-existent ID (WAVE: label_orphaned)
  const orphanedLabelRegex = /<label\b[^>]*\bfor\s*=\s*["']([^"']+)["'][^>]*>/gi;
  while ((match = orphanedLabelRegex.exec(cleanHtml)) !== null) {
    const labelTag = match[0];
    const forId = match[1];
    if (!allIds.has(forId)) {
      violations.push(createViolation(
        "label-orphaned",
        "moderate",
        "WCAG 1.3.1",
        `Label has for="${forId}" but no element with that ID exists on this page. The label is not associated with any form control.`,
        "https://dequeuniversity.com/rules/axe/4.9/label",
        truncate(labelTag, 200),
        `label[for="${forId}"]`
      ));
    }
  }

  // 10. Buttons without accessible text (WAVE: button_empty)
  const buttonRegex = /<button\b[^>]*>([\s\S]*?)<\/button>/gi;
  while ((match = buttonRegex.exec(cleanHtml)) !== null) {
    const fullTag = match[0];
    const openTag = fullTag.match(/<button[^>]*/i)?.[0] || "";
    const innerContent = match[1];
    if (inNoscript(match.index)) continue;
    const hasAriaLabel = /\baria-label\s*=\s*["'][^"']+["']/i.test(openTag);
    const hasAriaLabelledBy = /\baria-labelledby\s*=\s*["'][^"']+["']/i.test(openTag);
    const hasTitle = /\btitle\s*=\s*["'][^"']+["']/i.test(openTag);
    const hasImgWithAlt = /<img[^>]+\balt\s*=\s*["'][^"']+["']/i.test(innerContent);
    const hasSvgWithLabel =
      /<svg[^>]+\baria-label\s*=\s*["'][^"']+["']/i.test(innerContent) ||
      (/<svg\b/i.test(innerContent) && /<title\b[^>]*>[^<]+<\/title>/i.test(innerContent));
    const textContent = decodeEntities(innerContent.replace(/<[^>]*>/g, "")).trim();
    if (!hasAriaLabel && !hasAriaLabelledBy && !hasTitle && !hasImgWithAlt && !hasSvgWithLabel && textContent.length === 0) {
      violations.push(createViolation(
        "button-name",
        "critical",
        "WCAG 4.1.2",
        "Button has no accessible text. Screen readers will announce it as an unnamed button, making it impossible for users to understand its purpose.",
        "https://dequeuniversity.com/rules/axe/4.9/button-name",
        truncate(fullTag, 200),
        buildSelector(fullTag)
      ));
    }
  }

  // 11. Links without accessible text (WAVE: link_empty)
  const linkNameRegex = /<a\b[^>]*\bhref\b[^>]*>([\s\S]*?)<\/a>/gi;
  while ((match = linkNameRegex.exec(cleanHtml)) !== null) {
    const fullTag = match[0];
    const openTag = fullTag.match(/<a[^>]*/i)?.[0] || "";
    const innerContent = match[1];
    if (inNoscript(match.index)) continue;
    if (/\baria-hidden\s*=\s*["']true["']/i.test(openTag)) continue;
    const hasAriaLabel = /\baria-label\s*=\s*["'][^"']+["']/i.test(openTag);
    const hasAriaLabelledBy = /\baria-labelledby\s*=\s*["'][^"']+["']/i.test(openTag);
    const hasTitle = /\btitle\s*=\s*["'][^"']+["']/i.test(openTag);
    const hasImgWithAlt = /<img[^>]+\balt\s*=\s*["'][^"']+["']/i.test(innerContent);
    const hasSvgWithLabel =
      /<svg[^>]+\baria-label\s*=\s*["'][^"']+["']/i.test(innerContent) ||
      (/<svg\b/i.test(innerContent) && /<title\b[^>]*>[^<]+<\/title>/i.test(innerContent));
    const textContent = decodeEntities(innerContent.replace(/<[^>]*>/g, "")).trim();
    if (!hasAriaLabel && !hasAriaLabelledBy && !hasTitle && !hasImgWithAlt && !hasSvgWithLabel && textContent.length === 0) {
      violations.push(createViolation(
        "link-name",
        "serious",
        "WCAG 4.1.2",
        "Link has no accessible text. Screen readers cannot convey this link's purpose to the user.",
        "https://dequeuniversity.com/rules/axe/4.9/link-name",
        truncate(fullTag, 200),
        buildSelector(fullTag)
      ));
    }
  }

  // 12. Empty headings (WAVE: heading_empty)
  const emptyHeadingRegex = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  while ((match = emptyHeadingRegex.exec(cleanHtml)) !== null) {
    const level = match[1];
    const innerContent = match[2];
    const openTag = match[0].match(/<h[^>]*/i)?.[0] || "";
    const hasAriaLabel = /\baria-label\s*=\s*["'][^"']+["']/i.test(openTag);
    const hasAriaLabelledBy = /\baria-labelledby\s*=\s*["'][^"']+["']/i.test(openTag);
    const textContent = decodeEntities(innerContent.replace(/<[^>]*>/g, "")).trim();
    if (!hasAriaLabel && !hasAriaLabelledBy && textContent.length === 0) {
      violations.push(createViolation(
        "empty-heading",
        "serious",
        "WCAG 1.3.1",
        `Heading level ${level} (<h${level}>) is empty. Empty headings disrupt screen reader navigation by creating dead landmarks.`,
        "https://dequeuniversity.com/rules/axe/4.9/empty-heading",
        truncate(match[0], 200),
        buildSelector(match[0])
      ));
    }
  }

  // 13. Skipped heading levels (WAVE: heading_skipped)
  const headingLevelRegex = /<h([1-6])\b[^>]*>/gi;
  const headingLevels: number[] = [];
  while ((match = headingLevelRegex.exec(cleanHtml)) !== null) {
    headingLevels.push(parseInt(match[1]));
  }
  for (let i = 1; i < headingLevels.length; i++) {
    if (headingLevels[i] > headingLevels[i - 1] + 1) {
      violations.push(createViolation(
        "heading-order",
        "moderate",
        "WCAG 1.3.1",
        `Heading jumps from h${headingLevels[i - 1]} to h${headingLevels[i]}. Heading levels must be sequential; skipped levels confuse screen reader navigation.`,
        "https://dequeuniversity.com/rules/axe/4.9/heading-order",
        `<h${headingLevels[i]}>`,
        `h${headingLevels[i]}`
      ));
      break; // one report per page
    }
  }

  // 14. No headings on page at all (WAVE: heading_missing)
  const hasAnyHeading = /<h[1-6]\b/i.test(cleanHtml);
  if (!hasAnyHeading) {
    violations.push(createViolation(
      "heading-missing",
      "moderate",
      "WCAG 1.3.1",
      "Page has no heading elements (<h1>–<h6>). Headings allow screen reader users to navigate and understand page structure quickly.",
      "https://webaim.org/techniques/semanticstructure/#headings",
      "<body>",
      "body"
    ));
  }

  // 15. Headings exist but no <h1> (WAVE: heading_first_missing)
  if (hasAnyHeading && !/<h1\b/i.test(cleanHtml)) {
    violations.push(createViolation(
      "heading-first-missing",
      "moderate",
      "WCAG 1.3.1",
      "Page has headings but no <h1> element. Every page should have a top-level heading that describes its main topic.",
      "https://dequeuniversity.com/rules/axe/4.9/page-has-heading-one",
      "<body>",
      "body"
    ));
  }

  // 16. Iframes without title (WAVE: iframe_missing_title)
  const iframeRegex = /<iframe\b[^>]*>/gi;
  while ((match = iframeRegex.exec(cleanHtml)) !== null) {
    const tag = match[0];
    const hasTitle = /\btitle\s*=\s*["'][^"']+["']/i.test(tag);
    const hasAriaLabel = /\baria-label\s*=\s*["'][^"']+["']/i.test(tag);
    const hasAriaLabelledBy = /\baria-labelledby\s*=\s*["'][^"']+["']/i.test(tag);
    if (!hasTitle && !hasAriaLabel && !hasAriaLabelledBy) {
      violations.push(createViolation(
        "frame-title",
        "serious",
        "WCAG 4.1.2",
        "Iframe does not have a title attribute. Screen readers cannot identify the purpose of this embedded frame.",
        "https://dequeuniversity.com/rules/axe/4.9/frame-title",
        truncate(tag, 200),
        buildSelector(tag)
      ));
    }
  }

  // 17. Broken ARIA references — aria-labelledby/describedby/controls/owns (WAVE: broken_aria_reference)
  const ariaRefAttrs = ["aria-labelledby", "aria-describedby", "aria-controls", "aria-owns"];
  const ariaRefRegex = /<[^/][^>]*\b(?:aria-labelledby|aria-describedby|aria-controls|aria-owns)\s*=\s*["']([^"']+)["'][^>]*>/gi;
  while ((match = ariaRefRegex.exec(cleanHtml)) !== null) {
    const tag = match[0];
    for (const attr of ariaRefAttrs) {
      const attrRx = new RegExp(`\\b${attr}\\s*=\\s*["']([^"']+)["']`, "i");
      const attrMatch = attrRx.exec(tag);
      if (attrMatch) {
        const referencedIds = attrMatch[1].trim().split(/\s+/);
        for (const refId of referencedIds) {
          if (refId && !allIds.has(refId)) {
            violations.push(createViolation(
              "aria-reference-broken",
              "critical",
              "WCAG 4.1.2",
              `${attr}="${attrMatch[1]}" references id="${refId}" which does not exist on this page. Broken ARIA references cause screen readers to fail silently.`,
              "https://dequeuniversity.com/rules/axe/4.9/aria-valid-attr-value",
              truncate(tag, 200),
              buildSelector(tag)
            ));
            break;
          }
        }
      }
    }
  }

  // 18. role="presentation"/"none" on focusable elements (WAVE: role_presentation_focusable)
  const rolePresentationRegex = /<(?!\/)[a-z][^>]*\brole\s*=\s*["'](?:presentation|none)["'][^>]*>/gi;
  while ((match = rolePresentationRegex.exec(cleanHtml)) !== null) {
    const tag = match[0];
    const tabixMatch = /\btabindex\s*=\s*["']?(-?\d+)["']?/i.exec(tag);
    if (tabixMatch && parseInt(tabixMatch[1]) >= 0) {
      violations.push(createViolation(
        "role-presentation",
        "serious",
        "WCAG 4.1.2",
        'Element with role="presentation" is keyboard-focusable. This creates an invisible, confusing tab stop for keyboard and screen reader users.',
        "https://dequeuniversity.com/rules/axe/4.9/role-presentation",
        truncate(tag, 200),
        buildSelector(tag)
      ));
    }
  }

  // 19. aria-hidden="true" on focusable elements (WAVE: aria_hidden_focus)
  const ariaHiddenRegex = /<(?!\/)[a-z][^>]*\baria-hidden\s*=\s*["']true["'][^>]*>/gi;
  while ((match = ariaHiddenRegex.exec(cleanHtml)) !== null) {
    const tag = match[0];
    const tabixMatch = /\btabindex\s*=\s*["']?(-?\d+)["']?/i.exec(tag);
    if (tabixMatch && parseInt(tabixMatch[1]) >= 0) {
      violations.push(createViolation(
        "aria-hidden-focus",
        "serious",
        "WCAG 4.1.2",
        'Element with aria-hidden="true" is keyboard-focusable. Keyboard users reach it, but screen readers ignore it — the element disappears mid-navigation.',
        "https://dequeuniversity.com/rules/axe/4.9/aria-hidden-focus",
        truncate(tag, 200),
        buildSelector(tag)
      ));
    }
  }

  // 20. Duplicate IDs (WAVE: duplicate_id)
  const idRegex = /\bid\s*=\s*["']([^"']+)["']/gi;
  const idCounts: Record<string, number> = {};
  while ((match = idRegex.exec(cleanHtml)) !== null) {
    const id = match[1];
    idCounts[id] = (idCounts[id] || 0) + 1;
  }
  for (const [id, count] of Object.entries(idCounts)) {
    if (count > 1) {
      violations.push(createViolation(
        "duplicate-id",
        "moderate",
        "WCAG 4.1.1",
        `id="${id}" appears ${count} times. IDs must be unique; duplicate IDs break label associations, ARIA references, and anchor navigation.`,
        "https://dequeuniversity.com/rules/axe/4.9/duplicate-id",
        `id="${id}"`,
        `#${cssEscape(id)}`
      ));
    }
  }

  // 21. Autoplaying video without controls (WAVE: audio_video_absent / audio_video_track_missing)
  if (/<video\b[^>]*\bautoplay\b/i.test(cleanHtml) && !/<video\b[^>]*\bcontrols\b/i.test(cleanHtml)) {
    violations.push(createViolation(
      "video-autoplay",
      "moderate",
      "WCAG 1.4.2",
      "Video autoplays without providing controls. Users should be able to pause, stop, or mute auto-playing media.",
      "https://www.w3.org/WAI/WCAG21/Understanding/audio-control.html",
      "video",
      "video"
    ));
  }

  // 22. Autoplaying audio without controls
  if (/<audio\b[^>]*\bautoplay\b/i.test(cleanHtml) && !/<audio\b[^>]*\bcontrols\b/i.test(cleanHtml)) {
    violations.push(createViolation(
      "audio-autoplay",
      "moderate",
      "WCAG 1.4.2",
      "Audio autoplays without providing controls. Users should be able to pause, stop, or mute auto-playing media.",
      "https://www.w3.org/WAI/WCAG21/Understanding/audio-control.html",
      "audio",
      "audio"
    ));
  }

  // 23. Blink element (WAVE: blink)
  if (/<blink\b/i.test(cleanHtml)) {
    const blinkTag = /<blink\b[^>]*>/i.exec(cleanHtml);
    violations.push(createViolation(
      "blink",
      "serious",
      "WCAG 2.2.2",
      "A <blink> element is present. Blinking content cannot be paused and may trigger seizures in users with photosensitive epilepsy.",
      "https://www.w3.org/TR/WCAG21/#pause-stop-hide",
      blinkTag ? truncate(blinkTag[0], 200) : "<blink>",
      "blink"
    ));
  }

  // 24. Marquee element (WAVE: marquee)
  if (/<marquee\b/i.test(cleanHtml)) {
    const marqueeTag = /<marquee\b[^>]*>/i.exec(cleanHtml);
    violations.push(createViolation(
      "marquee",
      "serious",
      "WCAG 2.2.2",
      "A <marquee> element is present. Scrolling content cannot be paused by users, making it difficult or impossible to read for many disability groups.",
      "https://www.w3.org/TR/WCAG21/#pause-stop-hide",
      marqueeTag ? truncate(marqueeTag[0], 200) : "<marquee>",
      "marquee"
    ));
  }

  // 26. Data tables without any header cells (WAVE: table_col_header_invalid etc.)
  const tableRegex = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  while ((match = tableRegex.exec(cleanHtml)) !== null) {
    const tableTag = match[0];
    const tableContent = match[1];
    if (/\brole\s*=\s*["'](?:presentation|none)["']/i.test(tableTag)) continue;
    if (/<th\b[^>]*>/i.test(tableContent)) continue;
    const rows = tableContent.match(/<tr\b[^>]*>/gi) || [];
    if (rows.length >= 2) {
      violations.push(createViolation(
        "table-fake",
        "serious",
        "WCAG 1.3.1",
        "A data table has no header cells (<th>). Without headers, screen readers cannot identify what each column or row represents.",
        "https://dequeuniversity.com/rules/axe/4.9/table-fake",
        truncate(tableTag, 200),
        buildSelector(tableTag)
      ));
    }
  }

  // 27. Meta viewport disabling zoom (WAVE: meta_viewport)
  if (/<meta\b[^>]+\bviewport\b[^>]+\buser-scalable\s*=\s*["']?no["']?/i.test(cleanHtml) ||
      /<meta\b[^>]+\bviewport\b[^>]+\bmaximum-scale\s*=\s*["']?1(?:\.0)?["']?/i.test(cleanHtml)) {
    violations.push(createViolation(
      "meta-viewport",
      "serious",
      "WCAG 1.4.4",
      "Viewport meta tag prevents users from scaling the page. Users with low vision must be able to zoom to 200% without loss of content.",
      "https://dequeuniversity.com/rules/axe/4.9/meta-viewport",
      '<meta name="viewport">',
      "meta[name=viewport]"
    ));
  }

  // 28. Meta refresh (WAVE: meta_refresh)
  const metaRefreshMatch = /<meta\b[^>]+\bhttp-equiv\s*=\s*["']refresh["'][^>]*>/i.exec(cleanHtml);
  if (metaRefreshMatch) {
    const contentVal = /\bcontent\s*=\s*["'](\d+)/i.exec(metaRefreshMatch[0]);
    const delay = contentVal ? parseInt(contentVal[1]) : 0;
    violations.push(createViolation(
      "meta-refresh",
      delay === 0 ? "moderate" : "serious",
      "WCAG 2.2.1",
      delay === 0
        ? "Page uses an instant meta refresh/redirect. This can disorient screen reader users who are mid-way through reading content."
        : `Page auto-refreshes after ${delay} seconds. Auto-refreshing pages interrupt reading and cause loss of keyboard focus.`,
      "https://dequeuniversity.com/rules/axe/4.9/meta-refresh",
      truncate(metaRefreshMatch[0], 200),
      "meta[http-equiv=refresh]"
    ));
  }

  return violations;
}

// ─── Pass counting (mirrors WAVE "features" category) ───

function countPasses(cleanHtml: string): number {
  let passes = 0;

  // Images with meaningful alt text
  const imgTags = cleanHtml.match(/<img[^>]*>/gi) || [];
  for (const img of imgTags) {
    if (/\balt\s*=\s*["'][^"']+["']/i.test(img)) passes++;
  }

  // Links with descriptive text
  const linkTags = cleanHtml.match(/<a[^>]*href[^>]*>[\s\S]*?<\/a>/gi) || [];
  for (const link of linkTags) {
    const inner = link.replace(/<a[^>]*>/i, "").replace(/<\/a>/i, "");
    if (decodeEntities(inner.replace(/<[^>]*>/g, "")).trim().length > 0) passes++;
  }

  // Page language set
  if (/<html[^>]*\slang\s*=/i.test(cleanHtml)) passes++;

  // Non-empty page title
  if (/<title[^>]*>[^<]+<\/title>/i.test(cleanHtml)) passes++;

  // Has <main> landmark
  if (/<main\b/i.test(cleanHtml) || /\brole\s*=\s*["']main["']/i.test(cleanHtml)) passes++;

  // Has <nav> landmark
  if (/<nav\b/i.test(cleanHtml) || /\brole\s*=\s*["']navigation["']/i.test(cleanHtml)) passes++;

  // Has <header> / <footer> landmarks
  if (/<header\b/i.test(cleanHtml)) passes++;
  if (/<footer\b/i.test(cleanHtml)) passes++;

  // Has skip navigation link
  if (/href\s*=\s*["']#(?:main|content|skip|maincontent)[^"']*["']/i.test(cleanHtml)) passes++;

  // Has meta charset
  if (/<meta[^>]+charset/i.test(cleanHtml)) passes++;

  // Has viewport meta
  if (/<meta[^>]+viewport/i.test(cleanHtml)) passes++;

  // Has h1 heading
  if (/<h1\b/i.test(cleanHtml)) passes++;

  // Uses lists for grouped content
  if (/<(?:ul|ol)\b/i.test(cleanHtml)) passes++;

  // Form inputs with labels
  const inputs = cleanHtml.match(/<input[^>]*>/gi) || [];
  for (const input of inputs) {
    const typeMatch = /type\s*=\s*["']([^"']+)["']/i.exec(input);
    const inputType = typeMatch ? typeMatch[1].toLowerCase() : "text";
    if (["hidden", "submit", "reset", "button", "image"].includes(inputType)) continue;
    if (
      /\baria-label\s*=\s*["'][^"']+["']/i.test(input) ||
      /\baria-labelledby\s*=\s*["'][^"']+["']/i.test(input) ||
      /\bid\s*=\s*["'][^"']+["']/i.test(input)
    ) passes++;
  }

  // Buttons with accessible text
  const buttons = cleanHtml.match(/<button[^>]*>[\s\S]*?<\/button>/gi) || [];
  for (const btn of buttons) {
    const inner = btn.replace(/<button[^>]*>/i, "").replace(/<\/button>/i, "");
    if (
      decodeEntities(inner.replace(/<[^>]*>/g, "")).trim().length > 0 ||
      /\baria-label\s*=\s*["'][^"']+["']/i.test(btn)
    ) passes++;
  }

  // Tables with captions or summaries
  if (/<caption\b/i.test(cleanHtml)) passes++;

  // Fieldsets with legends
  if (/<fieldset\b/i.test(cleanHtml) && /<legend\b/i.test(cleanHtml)) passes++;

  // aria-live regions
  if (/\baria-live\s*=\s*["'](?:polite|assertive)["']/i.test(cleanHtml)) passes++;

  // Proper heading hierarchy (h1 present and headings used)
  if (/<h1\b/i.test(cleanHtml) && /<h[2-6]\b/i.test(cleanHtml)) passes++;

  return passes;
}

// ─── Scoring ───

function calculatePageScore(violations: Violation[], passCount: number): number {
  const weights: Record<string, number> = {
    critical: 12,
    serious: 6,
    moderate: 2,
    minor: 1,
  };

  const totalDeduction = violations.reduce((sum, v) => sum + (weights[v.impact] || 1), 0);
  const passBonus = Math.min(passCount * 0.5, 10);
  return Math.max(0, Math.min(100, Math.round(100 - totalDeduction + passBonus)));
}

function calculateOverallScore(
  violations: { impact: string }[],
  totalPages: number
): number {
  if (totalPages === 0) return 0;

  const weights: Record<string, number> = {
    critical: 15,
    serious: 8,
    moderate: 3,
    minor: 1,
  };

  const totalDeduction = violations.reduce((sum, v) => sum + (weights[v.impact] || 1), 0);
  return Math.max(0, Math.round(100 - totalDeduction));
}

// ─── Helpers ───

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}

function buildSelector(tag: string): string {
  const idMatch = tag.match(/id\s*=\s*["']([^"']+)["']/i);
  if (idMatch) return `#${idMatch[1]}`;

  const classMatch = tag.match(/class\s*=\s*["']([^"']+)["']/i);
  if (classMatch) {
    const firstClass = classMatch[1].split(/\s+/)[0];
    return `.${firstClass}`;
  }

  const tagMatch = tag.match(/<(\w+)/);
  return tagMatch ? tagMatch[1].toLowerCase() : "unknown";
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cssEscape(str: string): string {
  return str.replace(/([^\w-])/g, "\\$1");
}
