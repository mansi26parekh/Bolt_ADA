import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const HIGHLIGHT_SCRIPT = `<script>
(function () {
  var _highlighted = null;

  function clearHighlight() {
    if (_highlighted) {
      _highlighted.style.outline = '';
      _highlighted.style.outlineOffset = '';
      _highlighted.style.boxShadow = '';
      _highlighted = null;
    }
    var lbl = document.getElementById('__ada_badge__');
    if (lbl) lbl.remove();
  }

  function highlight(selector) {
    clearHighlight();
    var el = document.querySelector(selector);
    if (!el) {
      window.parent.postMessage({ type: 'ada-not-found', selector: selector }, '*');
      return;
    }
    _highlighted = el;
    el.style.outline = '3px solid #ef4444';
    el.style.outlineOffset = '3px';
    el.style.boxShadow = '0 0 0 8px rgba(239,68,68,0.15)';
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });

    var badge = document.createElement('div');
    badge.id = '__ada_badge__';
    badge.style.cssText =
      'position:fixed;top:14px;right:14px;display:flex;align-items:center;gap:6px;' +
      'background:#ef4444;color:#fff;font:600 11px/1 ui-sans-serif,system-ui,sans-serif;' +
      'padding:6px 10px;border-radius:6px;z-index:2147483647;pointer-events:none;' +
      'box-shadow:0 2px 12px rgba(0,0,0,0.4);';
    badge.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">' +
      '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>' +
      '</svg>ADA Inspector';
    document.body.appendChild(badge);

    window.parent.postMessage({ type: 'ada-found', selector: selector }, '*');
  }

  window.addEventListener('message', function (e) {
    if (!e.data) return;
    if (e.data.type === 'ada-highlight') highlight(e.data.selector);
    if (e.data.type === 'ada-clear') clearHighlight();
  });

  // Signal ready; parent will send selector
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      window.parent.postMessage({ type: 'ada-ready' }, '*');
    });
  } else {
    window.parent.postMessage({ type: 'ada-ready' }, '*');
  }
})();
</script>`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const targetUrl = new URL(req.url).searchParams.get("url");
  if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
    return new Response(JSON.stringify({ error: "Missing or invalid url parameter" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let html: string;
  try {
    const res = await fetch(targetUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(20_000),
    });
    html = await res.text();
  } catch (err) {
    return new Response(JSON.stringify({ error: `Fetch failed: ${String(err)}` }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Inject <base> so relative URLs resolve against the original origin
  const origin = new URL(targetUrl).origin;
  const baseTag = `<base href="${origin}/">`;
  if (!/<base\b/i.test(html)) {
    if (/<head[^>]*>/i.test(html)) {
      html = html.replace(/(<head[^>]*>)/i, `$1${baseTag}`);
    } else {
      html = baseTag + html;
    }
  }

  // Inject highlight script before </body>; fall back to appending
  if (/<\/body>/i.test(html)) {
    html = html.replace(/<\/body>/i, `${HIGHLIGHT_SCRIPT}</body>`);
  } else {
    html += HIGHLIGHT_SCRIPT;
  }

  return new Response(html, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/html; charset=utf-8",
      // Allow our app to embed this in an iframe
      "X-Frame-Options": "ALLOWALL",
      "Content-Security-Policy": "frame-ancestors *",
    },
  });
});
