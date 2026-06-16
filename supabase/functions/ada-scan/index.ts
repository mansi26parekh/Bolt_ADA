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

      const maxPages: number = body.maxPages || 50;

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

async function runMultiPageScan(
  supabase: ReturnType<typeof createClient>,
  scanId: string,
  rootUrl: string,
  maxDepth: number,
  maxPages: number
) {
  const visitedUrls = new Set<string>();
  const queuedUrls = new Set<string>(); // Track URLs scheduled for crawling
  const pagesToScan: { url: string; depth: number }[] = [];
  const discoveredPages: { url: string; depth: number; title: string; html: string }[] = [];
  let duplicatesSkipped = 0;

  // Add root URL to queue
  const normalizedRoot = normalizeUrl(rootUrl, rootUrl);
  if (normalizedRoot) {
    pagesToScan.push({ url: normalizedRoot, depth: 0 });
    queuedUrls.add(normalizedRoot);
  }

  // Phase 1: Crawl and discover pages
  while (pagesToScan.length > 0 && discoveredPages.length < maxPages) {
    const current = pagesToScan.shift()!;
    const normalizedUrl = normalizeUrl(current.url, rootUrl);

    if (!normalizedUrl || visitedUrls.has(normalizedUrl)) {
      duplicatesSkipped++;
      continue;
    }
    if (current.depth > maxDepth) continue;
    if (!isSameDomain(normalizedUrl, rootUrl)) continue;

    // Skip non-HTML URLs
    if (/\.(pdf|jpg|jpeg|png|gif|svg|css|js|ico|woff|woff2|ttf|eot|mp4|mp3|zip|doc|xls)$/i.test(normalizedUrl)) {
      continue;
    }

    visitedUrls.add(normalizedUrl);

    try {
      const pageData = await fetchPage(normalizedUrl);
      discoveredPages.push({
        url: normalizedUrl,
        depth: current.depth,
        title: pageData.title,
        html: pageData.html,
      });

      // Discover links from this page
      for (const link of pageData.links) {
        const normalized = normalizeUrl(link, rootUrl);
        if (normalized && !queuedUrls.has(normalized) && !visitedUrls.has(normalized) && isSameDomain(normalized, rootUrl)) {
          pagesToScan.push({ url: normalized, depth: current.depth + 1 });
          queuedUrls.add(normalized);
        }
      }
    } catch (err) {
      console.error(`Failed to fetch ${normalizedUrl}:`, err);
    }
  }

  console.log(`Crawl complete: ${discoveredPages.length} pages scanned, ${duplicatesSkipped} duplicates skipped`);

  await supabase
    .from("scans")
    .update({ total_pages: discoveredPages.length })
    .eq("id", scanId);

  // Phase 2: Create page records and analyze
  const allViolations: { impact: string }[] = [];
  let totalPasses = 0;
  let pagesScanned = 0;

  for (const page of discoveredPages) {
    const { data: pageRecord } = await supabase
      .from("scan_pages")
      .insert({
        scan_id: scanId,
        url: page.url,
        depth: page.depth,
        status: "running",
        title: page.title,
      })
      .select()
      .single();

    if (!pageRecord) continue;

    try {
      const analysis = analyzeAccessibility(page.html, page.url);
      const passCount = countPasses(page.html);

      // Debug: log per-page breakdown
      const byRule: Record<string, number> = {};
      for (const v of analysis) byRule[v.ruleId] = (byRule[v.ruleId] || 0) + 1;
      console.log(`[SCAN] ${page.url} | violations=${analysis.length} passes=${passCount} | ${JSON.stringify(byRule)}`);

      if (analysis.length > 0) {
        const results = analysis.map((v) => ({
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

        for (let i = 0; i < results.length; i += 50) {
          await supabase.from("scan_results").insert(results.slice(i, i + 50));
        }
      }

      const pageScore = calculatePageScore(analysis, passCount);
      allViolations.push(...analysis.map((v) => ({ impact: v.impact })));
      totalPasses += passCount;
      pagesScanned++;

      await supabase
        .from("scan_pages")
        .update({
          status: "completed",
          score: pageScore,
          violation_count: analysis.length,
          pass_count: passCount,
          completed_at: new Date().toISOString(),
        })
        .eq("id", pageRecord.id);
    } catch (err) {
      console.error(`Failed to analyze ${page.url}:`, err);
      await supabase
        .from("scan_pages")
        .update({ status: "failed", completed_at: new Date().toISOString() })
        .eq("id", pageRecord.id);
      pagesScanned++;
    }

    await supabase
      .from("scans")
      .update({ pages_scanned: pagesScanned })
      .eq("id", scanId);
  }

  const overallScore = calculateOverallScore(allViolations, discoveredPages.length);

  await supabase
    .from("scans")
    .update({
      status: "completed",
      score: overallScore,
      total_violations: allViolations.length,
      total_passes: totalPasses,
      pages_scanned: pagesScanned,
      completed_at: new Date().toISOString(),
    })
    .eq("id", scanId);
}

// ─── URL utilities ───

function normalizeUrl(href: string, baseUrl: string): string | null {
  try {
    const base = new URL(baseUrl);
    const resolved = new URL(href, base);
    // Skip javascript:, mailto:, tel:, data: etc
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
  const timeoutId = setTimeout(() => controller.abort(), 15000);

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

  // Extract links from <a> tags only
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
// This is a server-side HTML analysis. It parses the raw HTML to find
// accessibility violations. It is NOT a full browser-based audit (like
// axe-core running in a real DOM), so it focuses on checks that can be
// reliably performed on static HTML and avoids checks that require a
// rendered DOM (like computed color contrast).

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

const VIOLATION_TITLES: Record<string, string> = {
  "image-alt": "Missing alt text",
  "html-lang-valid": "No page language",
  "document-title": "Missing page title",
  "label": "Missing form label",
  "button-name": "Empty button",
  "link-name": "Empty or meaningless link",
  "empty-heading": "Empty heading",
  "heading-order": "Skipped heading level",
  "frame-title": "Iframe missing title",
  "input-image-alt": "Image input missing alt",
  "role-presentation": "Focusable with presentation role",
  "aria-hidden-focus": "Hidden but focusable",
  "duplicate-id": "Duplicate ID",
  "video-autoplay": "Video autoplay without controls",
  "audio-autoplay": "Audio autoplay without controls",
  "table-fake": "Data table missing headers",
  "meta-viewport": "Zoom disabled",
  "captcha": "Inaccessible CAPTCHA",
  "captcha-response": "CAPTCHA response field unlabeled",
  "third-party-iframe": "Third-party embed missing title",
  "third-party-social": "Social media widget detected",
  "third-party-chat": "Live chat widget detected",
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

function analyzeAccessibility(html: string, pageUrl: string): Violation[] {
  const violations: Violation[] = [];

  const cleanHtml = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  // Pre-compute positions of inputs/selects/textareas that are implicitly
  // labeled by being a descendant of a <label> element (no `for` needed).
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

  let match: RegExpExecArray | null;

  // 1. Images missing alt attribute
  const imgRegex = /<img\b[^>]*>/gi;
  while ((match = imgRegex.exec(cleanHtml)) !== null) {
    const imgTag = match[0];
    if (isInsideNoscript(cleanHtml, match.index)) continue;
    // Decorative images with role="presentation"/"none" don't need alt
    if (/\brole\s*=\s*["'](?:presentation|none)["']/i.test(imgTag)) continue;
    if (!/\balt\s*=/i.test(imgTag)) {
      violations.push(createViolation(
        "image-alt",
        "serious",
        "WCAG 1.1.1",
        "Image is missing an alt attribute. Screen readers cannot describe this image to users.",
        "https://dequeuniversity.com/rules/axe/4.9/image-alt",
        truncate(imgTag, 200),
        buildSelector(imgTag)
      ));
    }
  }

  // 2. Missing lang attribute on <html>
  const htmlTag = cleanHtml.match(/<html\b[^>]*>/i);
  if (htmlTag && !/\blang\s*=/i.test(htmlTag[0])) {
    violations.push(createViolation(
      "html-lang-valid",
      "serious",
      "WCAG 3.1.1",
      "The <html> element does not have a lang attribute. Screen readers use this to determine pronunciation.",
      "https://dequeuniversity.com/rules/axe/4.9/html-lang-valid",
      "<html>",
      "html"
    ));
  }

  // 3. Missing or empty document title
  const titleMatch = cleanHtml.match(/<title\b[^>]*>([^<]*)<\/title>/i);
  if (!titleMatch || titleMatch[1].trim().length === 0) {
    violations.push(createViolation(
      "document-title",
      "serious",
      "WCAG 2.4.2",
      "Document does not have a non-empty <title> element. Users rely on titles to identify pages.",
      "https://dequeuniversity.com/rules/axe/4.9/document-title",
      "<title>",
      "head > title"
    ));
  }

  // Helper: check whether a form control has an accessible label
  function controlHasLabel(tag: string, matchIndex: number): boolean {
    if (implicitLabeledPositions.has(matchIndex)) return true;
    // Non-empty aria-label
    if (/\baria-label\s*=\s*["'][^"']+["']/i.test(tag)) return true;
    // aria-labelledby referencing something
    if (/\baria-labelledby\s*=\s*["'][^"']+["']/i.test(tag)) return true;
    // non-empty title
    if (/\btitle\s*=\s*["'][^"']+["']/i.test(tag)) return true;
    // <label for="id"> matching this element's id
    const idMatch = /\bid\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (idMatch) {
      const labelRegex = new RegExp(`<label[^>]+\\bfor\\s*=\\s*["']${escapeRegex(idMatch[1])}["']`, "i");
      if (labelRegex.test(cleanHtml)) return true;
    }
    return false;
  }

  // 4. Form inputs without labels
  const inputRegex = /<input\b[^>]*>/gi;
  while ((match = inputRegex.exec(cleanHtml)) !== null) {
    const inputTag = match[0];
    if (isInsideNoscript(cleanHtml, match.index)) continue;
    const typeMatch = /\btype\s*=\s*["']([^"']+)["']/i.exec(inputTag);
    const inputType = typeMatch ? typeMatch[1].toLowerCase() : "text";

    if (inputType === "image") {
      // input[type=image] needs an alt attribute, not a label
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
        "Form input does not have an associated label. Users cannot determine what information to enter.",
        "https://dequeuniversity.com/rules/axe/4.9/label",
        truncate(inputTag, 200),
        buildSelector(inputTag)
      ));
    }
  }

  // 5. Select elements without labels
  const selectRegex = /<select\b[^>]*>/gi;
  while ((match = selectRegex.exec(cleanHtml)) !== null) {
    const selectTag = match[0];
    if (isInsideNoscript(cleanHtml, match.index)) continue;
    if (!controlHasLabel(selectTag, match.index)) {
      violations.push(createViolation(
        "label",
        "serious",
        "WCAG 1.3.1",
        "Select element does not have an associated label.",
        "https://dequeuniversity.com/rules/axe/4.9/label",
        truncate(selectTag, 200),
        buildSelector(selectTag)
      ));
    }
  }

  // 6. Textarea elements without labels
  const textareaRegex = /<textarea\b[^>]*>/gi;
  while ((match = textareaRegex.exec(cleanHtml)) !== null) {
    const textareaTag = match[0];
    if (isInsideNoscript(cleanHtml, match.index)) continue;
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

  // 7. Buttons without accessible text
  const buttonRegex = /<button\b[^>]*>([\s\S]*?)<\/button>/gi;
  while ((match = buttonRegex.exec(cleanHtml)) !== null) {
    const fullTag = match[0];
    const openTag = fullTag.match(/<button[^>]*/i)?.[0] || "";
    const innerContent = match[1];
    if (isInsideNoscript(cleanHtml, match.index)) continue;
    const hasAriaLabel = /\baria-label\s*=\s*["'][^"']+["']/i.test(openTag);
    const hasAriaLabelledBy = /\baria-labelledby\s*=\s*["'][^"']+["']/i.test(openTag);
    const hasTitle = /\btitle\s*=\s*["'][^"']+["']/i.test(openTag);
    const hasImgWithAlt = /<img[^>]+\balt\s*=\s*["'][^"']+["']/i.test(innerContent);
    const hasSvgWithLabel = /<svg[^>]+\baria-label\s*=\s*["'][^"']+["']/i.test(innerContent) ||
      /<svg[^>]+\brole\s*=\s*["']img["']/i.test(innerContent);
    const textContent = decodeEntities(innerContent.replace(/<[^>]*>/g, "")).trim();
    if (!hasAriaLabel && !hasAriaLabelledBy && !hasTitle && !hasImgWithAlt && !hasSvgWithLabel && textContent.length === 0) {
      violations.push(createViolation(
        "button-name",
        "critical",
        "WCAG 4.1.2",
        "Button has no accessible text. Screen readers will announce it as an unnamed button.",
        "https://dequeuniversity.com/rules/axe/4.9/button-name",
        truncate(fullTag, 200),
        buildSelector(fullTag)
      ));
    }
  }

  // 8. Links without accessible text
  const linkNameRegex = /<a\b[^>]*\bhref\b[^>]*>([\s\S]*?)<\/a>/gi;
  while ((match = linkNameRegex.exec(cleanHtml)) !== null) {
    const fullTag = match[0];
    const openTag = fullTag.match(/<a[^>]*/i)?.[0] || "";
    const innerContent = match[1];
    if (isInsideNoscript(cleanHtml, match.index)) continue;
    if (/\baria-hidden\s*=\s*["']true["']/i.test(openTag)) continue;
    const hasAriaLabel = /\baria-label\s*=\s*["'][^"']+["']/i.test(openTag);
    const hasAriaLabelledBy = /\baria-labelledby\s*=\s*["'][^"']+["']/i.test(openTag);
    const hasTitle = /\btitle\s*=\s*["'][^"']+["']/i.test(openTag);
    const hasImgWithAlt = /<img[^>]+\balt\s*=\s*["'][^"']+["']/i.test(innerContent);
    const hasSvgWithLabel = /<svg[^>]+\baria-label\s*=\s*["'][^"']+["']/i.test(innerContent) ||
      /<svg[^>]+\brole\s*=\s*["']img["']/i.test(innerContent);
    const textContent = decodeEntities(innerContent.replace(/<[^>]*>/g, "")).trim();
    if (!hasAriaLabel && !hasAriaLabelledBy && !hasTitle && !hasImgWithAlt && !hasSvgWithLabel && textContent.length === 0) {
      violations.push(createViolation(
        "link-name",
        "serious",
        "WCAG 4.1.2",
        "Link has no accessible text. Screen readers cannot describe this link's purpose to users.",
        "https://dequeuniversity.com/rules/axe/4.9/link-name",
        truncate(fullTag, 200),
        buildSelector(fullTag)
      ));
    }
  }

  // 9. Empty headings
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
        `Heading level ${level} is empty. Empty headings confuse screen reader users who navigate by headings.`,
        "https://dequeuniversity.com/rules/axe/4.9/empty-heading",
        truncate(match[0], 200),
        buildSelector(match[0])
      ));
    }
  }

  // 10. Skipped heading levels
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
        `Heading level skipped from h${headingLevels[i - 1]} to h${headingLevels[i]}. Heading levels should be sequential for screen reader navigation.`,
        "https://dequeuniversity.com/rules/axe/4.9/heading-order",
        `<h${headingLevels[i]}>`,
        `h${headingLevels[i]}`
      ));
      break; // one report per page
    }
  }

  // 11. Iframes without title
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

  // 12. role="presentation"/"none" on focusable elements (order-independent)
  const rolePresentationRegex = /<(?!\/)[a-z][^>]*\brole\s*=\s*["'](?:presentation|none)["'][^>]*>/gi;
  while ((match = rolePresentationRegex.exec(cleanHtml)) !== null) {
    const tag = match[0];
    const tabixMatch = /\btabindex\s*=\s*["']?(-?\d+)["']?/i.exec(tag);
    if (tabixMatch && parseInt(tabixMatch[1]) >= 0) {
      violations.push(createViolation(
        "role-presentation",
        "serious",
        "WCAG 4.1.2",
        "Element with role=\"presentation\" is focusable. This creates a confusing experience for screen reader users.",
        "https://dequeuniversity.com/rules/axe/4.9/role-presentation",
        truncate(tag, 200),
        buildSelector(tag)
      ));
    }
  }

  // 13. aria-hidden="true" on focusable elements (order-independent)
  const ariaHiddenRegex = /<(?!\/)[a-z][^>]*\baria-hidden\s*=\s*["']true["'][^>]*>/gi;
  while ((match = ariaHiddenRegex.exec(cleanHtml)) !== null) {
    const tag = match[0];
    const tabixMatch = /\btabindex\s*=\s*["']?(-?\d+)["']?/i.exec(tag);
    if (tabixMatch && parseInt(tabixMatch[1]) >= 0) {
      violations.push(createViolation(
        "aria-hidden-focus",
        "serious",
        "WCAG 4.1.2",
        "Element with aria-hidden=\"true\" is focusable. This makes content invisible to screen readers but still keyboard-accessible, which is contradictory.",
        "https://dequeuniversity.com/rules/axe/4.9/aria-hidden-focus",
        truncate(tag, 200),
        buildSelector(tag)
      ));
    }
  }

  // 14. Duplicate IDs
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
        `Duplicate id "${id}" found ${count} times. IDs must be unique for ARIA and label associations to work correctly.`,
        "https://dequeuniversity.com/rules/axe/4.9/duplicate-id",
        `id="${id}"`,
        `#${cssEscape(id)}`
      ));
    }
  }

  // 15. Autoplaying video without controls
  if (/<video\b[^>]*\bautoplay\b/i.test(cleanHtml) && !/<video\b[^>]*\bcontrols\b/i.test(cleanHtml)) {
    violations.push(createViolation(
      "video-autoplay",
      "moderate",
      "WCAG 1.4.2",
      "Video autoplays without providing controls. Users should be able to pause or stop auto-playing media.",
      "https://www.w3.org/WAI/WCAG21/Understanding/audio-control.html",
      "video",
      "video"
    ));
  }

  // 16. Autoplaying audio without controls
  if (/<audio\b[^>]*\bautoplay\b/i.test(cleanHtml) && !/<audio\b[^>]*\bcontrols\b/i.test(cleanHtml)) {
    violations.push(createViolation(
      "audio-autoplay",
      "moderate",
      "WCAG 1.4.2",
      "Audio autoplays without providing controls. Users should be able to pause or stop auto-playing media.",
      "https://www.w3.org/WAI/WCAG21/Understanding/audio-control.html",
      "audio",
      "audio"
    ));
  }

  // 17. Data tables without header cells
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
        "Data table does not use header cells (<th>). Table rows were found but no header cells, making it hard for screen readers to interpret the data.",
        "https://dequeuniversity.com/rules/axe/4.9/table-fake",
        truncate(tableTag, 200),
        buildSelector(tableTag)
      ));
    }
  }

  // 18. Meta viewport disabling zoom
  if (/<meta\b[^>]+\bviewport\b[^>]+\buser-scalable\s*=\s*["']?no["']?/i.test(cleanHtml)) {
    violations.push(createViolation(
      "meta-viewport",
      "moderate",
      "WCAG 1.4.4",
      "Page disables zooming via user-scalable=no in the viewport meta tag. Users with low vision need to be able to zoom.",
      "https://dequeuniversity.com/rules/axe/4.9/meta-viewport",
      "<meta name=\"viewport\">",
      "meta[name=viewport]"
    ));
  }

  // 19. CAPTCHA without accessible alternative
  const captchaPatterns: Array<{ regex: RegExp; label: string; selector: string }> = [
    {
      regex: /<(?:div|section|span)\b[^>]+\bclass\s*=\s*["'][^"']*\bg-recaptcha\b[^"']*["'][^>]*>/i,
      label: "Google reCAPTCHA", selector: ".g-recaptcha",
    },
    {
      regex: /<(?:div|section|span)\b[^>]+\bclass\s*=\s*["'][^"']*\bh-captcha\b[^"']*["'][^>]*>/i,
      label: "hCaptcha", selector: ".h-captcha",
    },
    {
      regex: /<(?:div|section|span)\b[^>]+\bclass\s*=\s*["'][^"']*\bcf-turnstile\b[^"']*["'][^>]*>/i,
      label: "Cloudflare Turnstile", selector: ".cf-turnstile",
    },
    {
      regex: /<[a-z][^>]+\bclass\s*=\s*["'][^"']*recaptcha[^"']*["'][^>]*>/i,
      label: "reCAPTCHA placeholder", selector: "[class*='recaptcha']",
    },
  ];

  const seenCaptcha = new Set<string>();
  for (const cp of captchaPatterns) {
    const captchaMatch = cp.regex.exec(html);
    if (captchaMatch && !seenCaptcha.has(cp.selector)) {
      seenCaptcha.add(cp.selector);
      violations.push(createViolation(
        "captcha",
        "serious",
        "WCAG 1.1.1",
        `${cp.label} detected. CAPTCHAs are inaccessible to users with visual or cognitive disabilities unless an audio or text-based alternative is provided.`,
        "https://www.w3.org/TR/WCAG21/#non-text-content",
        truncate(captchaMatch[0], 200),
        cp.selector
      ));
    }
  }

  // 20. CAPTCHA response fields present in HTML — only flag when the field is actually found
  // and lacks an accessible label. Does not fire on widget presence alone.
  const captchaResponseFields: Array<{ regex: RegExp; name: string; selector: string }> = [
    {
      regex: /<textarea\b[^>]*\bname\s*=\s*["']g-recaptcha-response["'][^>]*>/i,
      name: "g-recaptcha-response", selector: "textarea[name='g-recaptcha-response']",
    },
    {
      regex: /<textarea\b[^>]*\bname\s*=\s*["']h-captcha-response["'][^>]*>/i,
      name: "h-captcha-response", selector: "textarea[name='h-captcha-response']",
    },
    {
      regex: /<input\b[^>]*\bname\s*=\s*["']cf-turnstile-response["'][^>]*>/i,
      name: "cf-turnstile-response", selector: "input[name='cf-turnstile-response']",
    },
  ];
  for (const field of captchaResponseFields) {
    const fieldMatch = field.regex.exec(html);
    if (fieldMatch) {
      const tag = fieldMatch[0];
      const hasLabel = /\baria-label\s*=\s*["'][^"']+["']/i.test(tag) ||
        /\baria-labelledby\s*=\s*["'][^"']+["']/i.test(tag) ||
        /\btitle\s*=\s*["'][^"']+["']/i.test(tag);
      if (!hasLabel) {
        violations.push(createViolation(
          "captcha-response",
          "serious",
          "WCAG 1.3.1",
          `The CAPTCHA response field (${field.name}) has no accessible label. Screen readers cannot identify this field's purpose.`,
          "https://dequeuniversity.com/rules/axe/4.9/label",
          truncate(tag, 200),
          field.selector
        ));
      }
    }
  }

  // 21. Third-party iframes missing accessible title
  // YouTube, Vimeo, Google Maps, Calendly, Typeform, Spotify, etc.
  const thirdPartyIframePatterns: Array<{ regex: RegExp; label: string }> = [
    { regex: /src\s*=\s*["'][^"']*(?:youtube\.com\/embed|youtube-nocookie\.com\/embed)[^"']*["']/i, label: "YouTube video" },
    { regex: /src\s*=\s*["'][^"']*player\.vimeo\.com[^"']*["']/i, label: "Vimeo video" },
    { regex: /src\s*=\s*["'][^"']*google\.com\/maps\/embed[^"']*["']/i, label: "Google Maps" },
    { regex: /src\s*=\s*["'][^"']*calendly\.com[^"']*["']/i, label: "Calendly booking widget" },
    { regex: /src\s*=\s*["'][^"']*typeform\.com[^"']*["']/i, label: "Typeform embed" },
    { regex: /src\s*=\s*["'][^"']*open\.spotify\.com\/embed[^"']*["']/i, label: "Spotify player" },
    { regex: /src\s*=\s*["'][^"']*surveymonkey\.com[^"']*["']/i, label: "SurveyMonkey embed" },
    { regex: /src\s*=\s*["'][^"']*loom\.com\/embed[^"']*["']/i, label: "Loom video" },
    { regex: /src\s*=\s*["'][^"']*wistia\.(?:com|net)[^"']*["']/i, label: "Wistia video" },
  ];
  const iframeRegex = /<iframe\b[^>]*>/gi;
  while ((match = iframeRegex.exec(cleanHtml)) !== null) {
    const iframeTag = match[0];
    for (const tp of thirdPartyIframePatterns) {
      if (tp.regex.test(iframeTag)) {
        const hasTitle = /\btitle\s*=\s*["'][^"']+["']/i.test(iframeTag);
        if (!hasTitle) {
          violations.push(createViolation(
            "third-party-iframe",
            "serious",
            "Third Party",
            `${tp.label} embed is missing a title attribute. Screen readers cannot identify the purpose of this frame.`,
            "https://dequeuniversity.com/rules/axe/4.9/frame-title",
            truncate(iframeTag, 200),
            "iframe[src*='" + (tp.label.toLowerCase().replace(/ /g, "")) + "']"
          ));
        }
        break;
      }
    }
  }

  // 22. Social media widget divs/blockquotes injected by third-party scripts
  const socialPatterns: Array<{ regex: RegExp; label: string; selector: string }> = [
    { regex: /<blockquote\b[^>]+\bclass\s*=\s*["'][^"']*\btwitter-tweet\b[^"']*["'][^>]*>/i, label: "Embedded tweet (Twitter/X)", selector: "blockquote.twitter-tweet" },
    { regex: /<[a-z][^>]+\bclass\s*=\s*["'][^"']*\btwitter-timeline\b[^"']*["'][^>]*>/i, label: "Twitter/X timeline widget", selector: "[class*='twitter-timeline']" },
    { regex: /<div\b[^>]+\bclass\s*=\s*["'][^"']*\bfb-(?:like|comments|page|post|video)\b[^"']*["'][^>]*>/i, label: "Facebook widget", selector: "[class*='fb-']" },
    { regex: /<div\b[^>]+\bid\s*=\s*["']fb-root["'][^>]*>/i, label: "Facebook SDK (fb-root)", selector: "#fb-root" },
    { regex: /<blockquote\b[^>]+\bclass\s*=\s*["'][^"']*\binstagram-media\b[^"']*["'][^>]*>/i, label: "Instagram embed", selector: "blockquote.instagram-media" },
    { regex: /<[a-z][^>]+\bclass\s*=\s*["'][^"']*\blinkedin[^"']*["'][^>]*>/i, label: "LinkedIn widget", selector: "[class*='linkedin']" },
    { regex: /<[a-z][^>]+\bdata-pin-do\s*=/i, label: "Pinterest widget", selector: "[data-pin-do]" },
    { regex: /<[a-z][^>]+\bclass\s*=\s*["'][^"']*\btiktok-embed\b[^"']*["'][^>]*>/i, label: "TikTok embed", selector: ".tiktok-embed" },
  ];
  const seenSocial = new Set<string>();
  for (const sp of socialPatterns) {
    const socialMatch = sp.regex.exec(html);
    if (socialMatch && !seenSocial.has(sp.selector)) {
      seenSocial.add(sp.selector);
      violations.push(createViolation(
        "third-party-social",
        "moderate",
        "Third Party",
        `${sp.label} detected. Third-party social media widgets may not meet WCAG 2.1 standards and are outside your direct control. Verify the widget is keyboard navigable and screen-reader accessible.`,
        "https://www.w3.org/WAI/WCAG21/Understanding/non-text-content.html",
        truncate(socialMatch[0], 200),
        sp.selector
      ));
    }
  }

  // 23. Live chat / support widgets loaded via script
  // These inject floating UI elements that are often inaccessible to keyboard and AT users.
  // Detected from script src attributes in the raw HTML (before script tag stripping).
  const chatPatterns: Array<{ regex: RegExp; label: string }> = [
    { regex: /src\s*=\s*["'][^"']*(?:app\.intercom\.io|widget\.intercom\.io|js\.intercomcdn\.com)[^"']*["']/i, label: "Intercom chat" },
    { regex: /src\s*=\s*["'][^"']*js\.driftt\.com[^"']*["']/i, label: "Drift chat" },
    { regex: /src\s*=\s*["'][^"']*static\.zdassets\.com[^"']*["']/i, label: "Zendesk chat" },
    { regex: /src\s*=\s*["'][^"']*code\.tidio\.co[^"']*["']/i, label: "Tidio chat" },
    { regex: /src\s*=\s*["'][^"']*js\.hs-scripts\.com[^"']*["']/i, label: "HubSpot chat" },
    { regex: /src\s*=\s*["'][^"']*embed\.tawk\.to[^"']*["']/i, label: "Tawk.to chat" },
    { regex: /src\s*=\s*["'][^"']*wchat\.freshchat\.com[^"']*["']/i, label: "Freshchat widget" },
    { regex: /src\s*=\s*["'][^"']*client\.crisp\.chat[^"']*["']/i, label: "Crisp chat" },
    { regex: /src\s*=\s*["'][^"']*cdn\.livechatinc\.com[^"']*["']/i, label: "LiveChat widget" },
    { regex: /src\s*=\s*["'][^"']*cdn\.olark\.com[^"']*["']/i, label: "Olark chat" },
  ];
  const seenChat = new Set<string>();
  for (const cp of chatPatterns) {
    if (cp.regex.test(html) && !seenChat.has(cp.label)) {
      seenChat.add(cp.label);
      violations.push(createViolation(
        "third-party-chat",
        "moderate",
        "Third Party",
        `${cp.label} widget script detected. Live chat widgets inject floating UI that may not be keyboard-accessible or properly announced by screen readers. Verify the vendor's accessibility compliance.`,
        "https://www.w3.org/WAI/WCAG21/Understanding/keyboard.html",
        `<script src="[${cp.label}]">`,
        "script[src*='chat']"
      ));
    }
  }

  return violations;
}

// ─── Pass counting ───

function countPasses(html: string): number {
  const cleanHtml = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  let passes = 0;

  // Images with proper alt
  const imgTags = cleanHtml.match(/<img[^>]*>/gi) || [];
  for (const img of imgTags) {
    if (/alt\s*=\s*["'][^"']+["']/i.test(img)) passes++;
  }

  // Links with text
  const linkTags = cleanHtml.match(/<a[^>]*href[^>]*>[\s\S]*?<\/a>/gi) || [];
  for (const link of linkTags) {
    const inner = link.replace(/<a[^>]*>/i, "").replace(/<\/a>/i, "");
    if (decodeEntities(inner.replace(/<[^>]*>/g, "")).trim().length > 0) passes++;
  }

  // Has lang
  if (/<html[^>]*\slang\s*=/i.test(cleanHtml)) passes++;

  // Has title
  if (/<title[^>]*>[^<]+<\/title>/i.test(cleanHtml)) passes++;

  // Has main landmark
  if (/<main[^>]*>/i.test(cleanHtml) || /role\s*=\s*["']main["']/i.test(cleanHtml)) passes++;

  // Has meta viewport
  if (/<meta[^>]+viewport/i.test(cleanHtml)) passes++;

  // Has charset
  if (/<meta[^>]+charset/i.test(cleanHtml)) passes++;

  // Form inputs with labels
  const inputs = cleanHtml.match(/<input[^>]*>/gi) || [];
  for (const input of inputs) {
    const typeMatch = /type\s*=\s*["']([^"']+)["']/i.exec(input);
    const inputType = typeMatch ? typeMatch[1].toLowerCase() : "text";
    if (["hidden", "submit", "reset", "button", "image"].includes(inputType)) continue;
    if (/id\s*=\s*["'][^"']+["']/i.test(input) || /aria-label\s*=\s*["'][^"']+["']/i.test(input)) passes++;
  }

  // Buttons with text
  const buttons = cleanHtml.match(/<button[^>]*>[\s\S]*?<\/button>/gi) || [];
  for (const btn of buttons) {
    const inner = btn.replace(/<button[^>]*>/i, "").replace(/<\/button>/i, "");
    if (decodeEntities(inner.replace(/<[^>]*>/g, "")).trim().length > 0 || /aria-label\s*=\s*["'][^"']+["']/i.test(btn)) passes++;
  }

  // Proper heading hierarchy
  const headings = cleanHtml.match(/<h[1-6][^>]*>/gi) || [];
  if (headings.length > 0 && /<h1/i.test(cleanHtml)) passes++;

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

  const totalDeduction = violations.reduce((sum, v) => {
    return sum + (weights[v.impact] || 1);
  }, 0);

  return Math.max(0, Math.round(100 - totalDeduction));
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

  const totalDeduction = violations.reduce((sum, v) => {
    return sum + (weights[v.impact] || 1);
  }, 0);

  return Math.max(0, Math.round(100 - totalDeduction));
}

// ─── Helpers ───

function isInsideNoscript(html: string, tagIndex: number): boolean {
  const before = html.substring(0, tagIndex);
  const noscriptOpens = (before.match(/<noscript/gi) || []).length;
  const noscriptCloses = (before.match(/<\/noscript/gi) || []).length;
  return noscriptOpens > noscriptCloses;
}

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
