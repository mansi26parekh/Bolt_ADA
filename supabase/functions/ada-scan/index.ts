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
      const maxPages = body.maxPages || 50;

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
  let totalViolations = 0;
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
      totalViolations += analysis.length;
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

  const overallScore = calculateOverallScore(totalViolations, totalPasses, discoveredPages.length);

  await supabase
    .from("scans")
    .update({
      status: "completed",
      score: overallScore,
      total_violations: totalViolations,
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
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; ADA-Scanner/2.0; +https://ada-scanner.dev)",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
    redirect: "follow",
  });

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
  "link-name": "Empty link text",
  "label": "Missing form label",
  "heading-order": "Heading order issue",
  "button-name": "Empty button",
  "role-presentation": "Focusable with presentation role",
  "aria-hidden-focus": "Hidden but focusable",
  "frame-title": "Untitled iframe",
  "duplicate-id": "Duplicate ID",
  "video-autoplay": "Video autoplay",
  "audio-autoplay": "Audio autoplay",
  "table-fake": "Table missing headers",
  "meta-viewport": "Zoom disabled",
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

  // Strip <script> and <style> content to avoid false positives from
  // CSS/JS strings that look like HTML elements
  const cleanHtml = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  // 1. Images missing alt attribute
  const imgRegex = /<img[^>]*>/gi;
  let match;
  while ((match = imgRegex.exec(cleanHtml)) !== null) {
    const imgTag = match[0];
    if (isInsideNoscript(cleanHtml, match.index)) continue;

    if (!/alt\s*=/i.test(imgTag)) {
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
  const htmlTag = cleanHtml.match(/<html[^>]*>/i);
  if (htmlTag && !/lang\s*=/i.test(htmlTag[0])) {
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
  const titleMatch = cleanHtml.match(/<title[^>]*>([^<]*)<\/title>/i);
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

  // 4. Links without discernible text
  const linkRegex = /<a\s[^>]*href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  while ((match = linkRegex.exec(cleanHtml)) !== null) {
    const fullTag = match[0];
    const href = match[1];
    const innerContent = match[2];

    if (href.startsWith("#")) continue;
    if (isInsideNoscript(cleanHtml, match.index)) continue;

    const hasAriaLabel = /aria-label\s*=\s*["'][^"']+["']/i.test(fullTag);
    const hasAriaLabelledBy = /aria-labelledby\s*=\s*["'][^"']+["']/i.test(fullTag);
    const hasTitle = /title\s*=\s*["'][^"']+["']/i.test(fullTag);
    const hasImgWithAlt = /<img[^>]+alt\s*=\s*["'][^"']+["']/i.test(innerContent);
    const hasSvgWithLabel = /<svg[^>]+aria-label\s*=\s*["'][^"']+["']/i.test(innerContent) ||
      /<svg[^>]+role\s*=\s*["']img["']/i.test(innerContent);
    const textContent = decodeEntities(innerContent.replace(/<[^>]*>/g, "")).trim();

    if (!hasAriaLabel && !hasAriaLabelledBy && !hasTitle && !hasImgWithAlt && !hasSvgWithLabel && textContent.length === 0) {
      violations.push(createViolation(
        "link-name",
        "serious",
        "WCAG 2.4.4",
        "Link has no discernible text. Screen readers will announce the href URL instead of a meaningful name.",
        "https://dequeuniversity.com/rules/axe/4.9/link-name",
        truncate(fullTag, 200),
        buildSelector(fullTag)
      ));
    }
  }

  // 5. Form inputs without associated labels
  const inputRegex = /<input[^>]*>/gi;
  while ((match = inputRegex.exec(cleanHtml)) !== null) {
    const inputTag = match[0];
    if (isInsideNoscript(cleanHtml, match.index)) continue;

    const typeMatch = /type\s*=\s*["']([^"']+)["']/i.exec(inputTag);
    const inputType = typeMatch ? typeMatch[1].toLowerCase() : "text";
    if (["hidden", "submit", "reset", "button", "image"].includes(inputType)) continue;

    const hasId = /id\s*=\s*["'][^"']+["']/i.test(inputTag);
    const hasAriaLabel = /aria-label\s*=\s*["'][^"']+["']/i.test(inputTag);
    const hasAriaLabelledBy = /aria-labelledby\s*=\s*["'][^"']+["']/i.test(inputTag);
    const hasTitle = /title\s*=\s*["'][^"']+["']/i.test(inputTag);

    let hasLabelFor = false;
    if (hasId) {
      const idMatch = /id\s*=\s*["']([^"']+)["']/i.exec(inputTag);
      if (idMatch) {
        const labelRegex = new RegExp(`<label[^>]+for\\s*=\\s*["']${escapeRegex(idMatch[1])}["']`, "i");
        hasLabelFor = labelRegex.test(cleanHtml);
      }
    }

    if (!hasAriaLabel && !hasAriaLabelledBy && !hasTitle && !hasLabelFor) {
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

  // 6. Select elements without labels
  const selectRegex = /<select[^>]*>/gi;
  while ((match = selectRegex.exec(cleanHtml)) !== null) {
    const selectTag = match[0];
    if (isInsideNoscript(cleanHtml, match.index)) continue;

    const hasId = /id\s*=\s*["'][^"']+["']/i.test(selectTag);
    const hasAriaLabel = /aria-label\s*=\s*["'][^"']+["']/i.test(selectTag);
    const hasAriaLabelledBy = /aria-labelledby\s*=\s*["'][^"']+["']/i.test(selectTag);
    const hasTitle = /title\s*=\s*["'][^"']+["']/i.test(selectTag);

    let hasLabelFor = false;
    if (hasId) {
      const idMatch = /id\s*=\s*["']([^"']+)["']/i.exec(selectTag);
      if (idMatch) {
        const labelRegex = new RegExp(`<label[^>]+for\\s*=\\s*["']${escapeRegex(idMatch[1])}["']`, "i");
        hasLabelFor = labelRegex.test(cleanHtml);
      }
    }

    if (!hasAriaLabel && !hasAriaLabelledBy && !hasTitle && !hasLabelFor) {
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

  // 7. Textarea elements without labels
  const textareaRegex = /<textarea[^>]*>/gi;
  while ((match = textareaRegex.exec(cleanHtml)) !== null) {
    const textareaTag = match[0];
    if (isInsideNoscript(cleanHtml, match.index)) continue;

    const hasId = /id\s*=\s*["'][^"']+["']/i.test(textareaTag);
    const hasAriaLabel = /aria-label\s*=\s*["'][^"']+["']/i.test(textareaTag);
    const hasAriaLabelledBy = /aria-labelledby\s*=\s*["'][^"']+["']/i.test(textareaTag);
    const hasTitle = /title\s*=\s*["'][^"']+["']/i.test(textareaTag);

    let hasLabelFor = false;
    if (hasId) {
      const idMatch = /id\s*=\s*["']([^"']+)["']/i.exec(textareaTag);
      if (idMatch) {
        const labelRegex = new RegExp(`<label[^>]+for\\s*=\\s*["']${escapeRegex(idMatch[1])}["']`, "i");
        hasLabelFor = labelRegex.test(cleanHtml);
      }
    }

    if (!hasAriaLabel && !hasAriaLabelledBy && !hasTitle && !hasLabelFor) {
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

  // 8. Heading hierarchy - missing h1
  const headings = [...cleanHtml.matchAll(/<h([1-6])[^>]*>/gi)];
  if (headings.length > 0) {
    const hasH1 = headings.some((h) => /<h1/i.test(h[0]));
    if (!hasH1) {
      violations.push(createViolation(
        "heading-order",
        "moderate",
        "WCAG 1.3.1",
        "Page has headings but is missing an h1. The h1 is the primary heading and helps users understand the page topic.",
        "https://dequeuniversity.com/rules/axe/4.9/heading-order",
        headings[0][0],
        buildSelector(headings[0][0])
      ));
    }

    const levels = headings.map((h) => parseInt(h[1]));
    for (let i = 1; i < levels.length; i++) {
      if (levels[i] - levels[i - 1] > 1) {
        violations.push(createViolation(
          "heading-order",
          "moderate",
          "WCAG 1.3.1",
          `Heading level skipped from h${levels[i - 1]} to h${levels[i]}. Heading levels should not skip to maintain a logical content hierarchy.`,
          "https://dequeuniversity.com/rules/axe/4.9/heading-order",
          headings[i][0],
          buildSelector(headings[i][0])
        ));
      }
    }
  }

  // 9. Buttons without accessible text
  const buttonRegex = /<button[^>]*>([\s\S]*?)<\/button>/gi;
  while ((match = buttonRegex.exec(cleanHtml)) !== null) {
    const fullTag = match[0];
    const innerContent = match[1];
    if (isInsideNoscript(cleanHtml, match.index)) continue;

    const hasAriaLabel = /aria-label\s*=\s*["'][^"']+["']/i.test(fullTag);
    const hasAriaLabelledBy = /aria-labelledby\s*=\s*["'][^"']+["']/i.test(fullTag);
    const hasTitle = /title\s*=\s*["'][^"']+["']/i.test(fullTag);
    const hasImgWithAlt = /<img[^>]+alt\s*=\s*["'][^"']+["']/i.test(innerContent);
    const hasSvgWithLabel = /<svg[^>]+aria-label\s*=\s*["'][^"']+["']/i.test(innerContent) ||
      /<svg[^>]+role\s*=\s*["']img["']/i.test(innerContent);
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

  // 10. ARIA role on elements that shouldn't have it
  const focusableWithPresentation = /<[^>]+role\s*=\s*["']presentation["'][^>]*tabindex\s*=\s*["'][^"']+["']/gi;
  while ((match = focusableWithPresentation.exec(cleanHtml)) !== null) {
    violations.push(createViolation(
      "role-presentation",
      "serious",
      "WCAG 4.1.2",
      "Element with role=\"presentation\" is focusable. This creates a confusing experience for screen reader users.",
      "https://dequeuniversity.com/rules/axe/4.9/role-presentation",
      truncate(match[0], 200),
      buildSelector(match[0])
    ));
  }

  // 11. aria-hidden on focusable elements
  const ariaHiddenFocusable = /<[^>]+aria-hidden\s*=\s*["']true["'][^>]*tabindex\s*=\s*["'][^"']+["']/gi;
  while ((match = ariaHiddenFocusable.exec(cleanHtml)) !== null) {
    violations.push(createViolation(
      "aria-hidden-focus",
      "serious",
      "WCAG 4.1.2",
      "Element with aria-hidden=\"true\" is focusable. This makes content invisible to screen readers but still keyboard-accessible, which is contradictory.",
      "https://dequeuniversity.com/rules/axe/4.9/aria-hidden-focus",
      truncate(match[0], 200),
      buildSelector(match[0])
    ));
  }

  // 12. iframe without title
  const iframeRegex = /<iframe[^>]*>/gi;
  while ((match = iframeRegex.exec(cleanHtml)) !== null) {
    if (isInsideNoscript(cleanHtml, match.index)) continue;
    if (!/title\s*=\s*["'][^"']+["']/i.test(match[0])) {
      violations.push(createViolation(
        "frame-title",
        "serious",
        "WCAG 2.4.1",
        "iframe does not have a title attribute. Screen readers announce iframes as unnamed frames.",
        "https://dequeuniversity.com/rules/axe/4.9/frame-title",
        truncate(match[0], 200),
        buildSelector(match[0])
      ));
    }
  }

  // 13. Duplicate IDs
  const idRegex = /id\s*=\s*["']([^"']+)["']/gi;
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

  // 15. Autoplaying video/audio without controls
  if (/<video[^>]+autoplay/i.test(cleanHtml) && !/<video[^>]+controls/i.test(cleanHtml)) {
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

  if (/<audio[^>]+autoplay/i.test(cleanHtml) && !/<audio[^>]+controls/i.test(cleanHtml)) {
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

  // 16. Tables without headers
  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  while ((match = tableRegex.exec(cleanHtml)) !== null) {
    const tableTag = match[0];
    const tableContent = match[1];
    if (/role\s*=\s*["'](?:presentation|none)["']/i.test(tableTag)) continue;
    if (/<th[^>]*>/i.test(tableContent)) continue;
    const rows = tableContent.match(/<tr[^>]*>/gi) || [];
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

  // 17. Meta viewport with user-scalable=no
  if (/<meta[^>]+viewport[^>]+user-scalable\s*=\s*["']no["']/i.test(cleanHtml)) {
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

function calculateOverallScore(totalViolations: number, totalPasses: number, totalPages: number): number {
  if (totalPages === 0) return 0;
  if (totalViolations === 0) return 100;
  const ratio = totalPasses / (totalPasses + totalViolations);
  return Math.round(ratio * 100);
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
