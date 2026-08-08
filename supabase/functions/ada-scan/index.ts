import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import {
  analyzeAccessibility,
  calculatePageScore,
  calculateOverallScore,
} from "./analysis.ts";
import { fetchRenderedPage } from "./browser.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

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

      // Paginate results — Supabase caps each query at 1000 rows
      let allResults: Record<string, unknown>[] = [];
      let offset = 0;
      while (true) {
        const { data: batch } = await supabase
          .from("scan_results").select("*").eq("scan_id", scanId)
          .order("created_at", { ascending: true })
          .range(offset, offset + 999);
        if (!batch || batch.length === 0) break;
        allResults = allResults.concat(batch as Record<string, unknown>[]);
        if (batch.length < 1000) break;
        offset += 1000;
      }

      return new Response(
        JSON.stringify({ scan, pages: pages || [], results: allResults }),
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

function dedupeUrl(raw: string, base: string, rootOriginLen: number): string | null {
  const norm = normalizeUrl(raw, base);
  if (!norm) return null;
  try {
    const u = new URL(norm);
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

// ─── Sitemap discovery ───

async function fetchSitemapUrls(origin: string): Promise<Set<string>> {
  const urls = new Set<string>();

  try {
    const robotsRes = await fetch(`${origin}/robots.txt`, {
      signal: AbortSignal.timeout(10_000),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ADA-Scanner/2.0; +https://ada-scanner.dev)",
        Accept: "text/plain, */*",
      },
      redirect: "follow",
    });
    if (robotsRes.ok) {
      const robotsText = await robotsRes.text();
      const sitemapRe = /^Sitemap:\s*(.+)/gim;
      let sm: RegExpExecArray | null;
      while ((sm = sitemapRe.exec(robotsText)) !== null) {
        await parseSitemap(sm[1].trim(), urls, 0);
      }
    }
  } catch { /* robots.txt not available */ }

  if (urls.size === 0) {
    await parseSitemap(`${origin}/sitemap.xml`, urls, 0);
  }

  return urls;
}

async function parseSitemap(sitemapUrl: string, urls: Set<string>, depth: number): Promise<void> {
  if (depth > 2) return;

  let res: Response;
  try {
    res = await fetch(sitemapUrl, {
      signal: AbortSignal.timeout(15_000),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ADA-Scanner/2.0; +https://ada-scanner.dev)",
        Accept: "application/xml, text/xml, */*",
      },
      redirect: "follow",
    });
  } catch { return; }

  if (!res.ok) return;

  const text = await res.text();
  const locRe = /<loc>\s*([^<]+?)\s*<\/loc>/gi;

  if (/<sitemapindex/i.test(text)) {
    let m: RegExpExecArray | null;
    while ((m = locRe.exec(text)) !== null) {
      await parseSitemap(m[1].trim(), urls, depth + 1);
    }
  } else {
    let m: RegExpExecArray | null;
    while ((m = locRe.exec(text)) !== null) {
      urls.add(m[1].trim());
    }
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

  try {
    const sitemapUrls = await fetchSitemapUrls(new URL(rootUrl).origin);
    for (const smUrl of sitemapUrls) {
      const norm = dedupeUrl(smUrl, rootUrl, rootOriginLen);
      if (!norm || visited.has(norm) || visited.size >= maxPages) continue;
      if (NON_HTML_RE.test(norm)) continue;
      try {
        if (new URL(norm).hostname !== rootHostname) continue;
      } catch { continue; }
      visited.add(norm);
      queue.push({ url: norm, depth: 0 });
    }
  } catch (err) {
    console.error("Sitemap fetch failed:", err);
  }

  const processPage = async (url: string, depth: number) => {
    const insertPromise = supabase
      .from("scan_pages")
      .insert({ scan_id: scanId, url, depth, status: "running", title: null })
      .select("id")
      .single();

    let pageData: { html: string; title: string; links: string[]; baseUrl: string };
    try {
      pageData = await fetchPageWithRendering(url);
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

    for (const link of pageData.links) {
      const norm = dedupeUrl(link, pageData.baseUrl, rootOriginLen);
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

    const { violations: analysis, passCount } = analyzeAccessibility(pageData.html, url);
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

type PageData = { html: string; title: string; links: string[]; baseUrl: string };

async function fetchPageWithRendering(url: string): Promise<PageData> {
  const browserWs = Deno.env.get("BROWSER_WS_ENDPOINT");
  if (browserWs) {
    try {
      return await fetchRenderedPage(browserWs, url);
    } catch (err) {
      console.warn(`Browser rendering failed for ${url}, falling back to static fetch:`, err);
    }
  }
  return fetchPage(url);
}

async function fetchPage(url: string): Promise<PageData> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  let response: Response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
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
  const html = rawHtml.length > 204_800 ? rawHtml.slice(0, 204_800) : rawHtml;

  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : new URL(url).pathname;

  const linkRegex = /<a[^>]+href\s*=\s*["']([^"']+)["']/gi;
  const areaRegex = /<area[^>]+href\s*=\s*["']([^"']+)["']/gi;
  const links: string[] = [];
  let m;
  while ((m = linkRegex.exec(html)) !== null) links.push(m[1]);
  while ((m = areaRegex.exec(html)) !== null) links.push(m[1]);

  let baseUrl = url;
  const baseMatch = html.match(/<base\b[^>]*\bhref\s*=\s*["']([^"']+)["']/i);
  if (baseMatch) {
    try { baseUrl = new URL(baseMatch[1], url).toString(); } catch { /* keep page URL */ }
  }

  return { html, title, links, baseUrl };
}
