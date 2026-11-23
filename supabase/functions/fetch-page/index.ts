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

  function normalizeHtml(s) {
    return s.replace(/\\s+/g, ' ').replace(/\\s+/g, ' ').trim().toLowerCase();
  }

  function hidePreloaders() {
    var els = document.querySelectorAll('[class*="preloader"],[id*="preloader"],[class*="page-loader"],[id*="page-loader"],.loader-wrapper,#loader-wrapper');
    for (var i = 0; i < els.length; i++) {
      if (els[i].id === '__ada_badge__') continue;
      els[i].style.setProperty('display', 'none', 'important');
    }
  }

  function safeQueryAll(sel) {
    try { return Array.prototype.slice.call(document.querySelectorAll(sel)); } catch (e) { return []; }
  }

  // Stored attribute values may be truncated, and JS may insert siblings
  // that shift :nth-of-type indexes, so progressively relax the selector.
  function relaxedSelectors(selector) {
    var prefix = selector.replace(/="/g, '^="');
    var noNth = prefix.replace(/:nth-of-type\\(\\d+\\)/g, '');
    var list = [selector, prefix, noNth];
    var parts = noNth.split(' > ');
    if (parts.length > 1) list.push(parts[parts.length - 1]);
    if (/g-recaptcha-response/.test(selector)) list.push('textarea[name="g-recaptcha-response"]', '[id^="g-recaptcha-response"]');
    if (/h-captcha-response/.test(selector)) list.push('textarea[name="h-captcha-response"]', '[id^="h-captcha-response"]');
    return list;
  }

  function signatureOf(elementHtml) {
    var m = elementHtml && elementHtml.match(/^\\s*<([a-zA-Z][\\w-]*)([^>]*)>/);
    if (!m) return null;
    var tpl = document.createElement('template');
    tpl.innerHTML = '<' + m[1] + m[2] + '></' + m[1] + '>';
    var el = tpl.content.firstElementChild;
    if (!el) return null;
    var attrs = {};
    ['id', 'name', 'href', 'src', 'aria-label', 'type', 'title', 'placeholder', 'for'].forEach(function (a) {
      var v = el.getAttribute(a);
      if (v) attrs[a] = v;
    });
    return { tag: m[1].toLowerCase(), attrs: attrs };
  }

  function matchesSignature(el, sig) {
    if (el.tagName.toLowerCase() !== sig.tag) return false;
    var keys = Object.keys(sig.attrs);
    if (keys.length === 0) return false;
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i], want = sig.attrs[k];
      var have = el.getAttribute(k) || (k === 'src' ? (el.getAttribute('data-src') || el.getAttribute('data-lazy-src') || '') : '');
      if (have !== want && have.indexOf(want) !== 0) return false;
    }
    return true;
  }

  function pickBest(cands, elementHtml, sig) {
    if (cands.length === 1) return cands[0];
    if (cands.length === 0) return null;
    var normStored = elementHtml ? normalizeHtml(elementHtml) : '';
    for (var i = 0; i < cands.length; i++) {
      var n = normalizeHtml(cands[i].outerHTML);
      if (normStored && (n === normStored || n.indexOf(normStored) === 0 || normStored.indexOf(n) === 0)) return cands[i];
    }
    if (sig) {
      var sigMatches = cands.filter(function (c) { return matchesSignature(c, sig); });
      var vis = sigMatches.filter(isRendered);
      if (vis.length) return vis[0];
      if (sigMatches.length) return sigMatches[0];
    }
    var visible = cands.filter(isRendered);
    return visible[0] || cands[0];
  }

  function findElement(selector, elementHtml) {
    var sig = signatureOf(elementHtml);
    var sels = relaxedSelectors(selector);
    for (var s = 0; s < sels.length; s++) {
      var cands = safeQueryAll(sels[s]);
      if (s === sels.length - 1 || s >= 3) {
        if (sig) cands = cands.filter(function (c) { return matchesSignature(c, sig); });
      }
      if (cands.length) return pickBest(cands, elementHtml, sig);
    }
    var exact = findExactElement(selector, elementHtml);
    if (exact) return exact;
    if (sig) {
      var bySig = safeQueryAll(sig.tag).filter(function (c) { return matchesSignature(c, sig); });
      if (bySig.length) return pickBest(bySig, elementHtml, sig);
    }
    return null;
  }

  function isRendered(el) {
    if (!el.getClientRects || el.getClientRects().length === 0) return false;
    var cs = window.getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  }

  function visibleTarget(el) {
    var cur = el;
    while (cur && cur !== document.documentElement) {
      if (isRendered(cur)) return cur;
      cur = cur.parentElement;
    }
    return document.body;
  }

  function findExactElement(selector, elementHtml) {
    // Strategy 1: Use CSS selector and disambiguate by elementHtml
    try {
      var matches = document.querySelectorAll(selector);
      if (matches.length === 1) return matches[0];
      if (matches.length > 1 && elementHtml) {
        var normStored = normalizeHtml(elementHtml);
        for (var i = 0; i < matches.length; i++) {
          var candidate = matches[i];
          var normCandidate = normalizeHtml(candidate.outerHTML);
          if (normCandidate === normStored) return candidate;
          if (normCandidate.indexOf(normStored) === 0 || normStored.indexOf(normCandidate) === 0) return candidate;
        }
        // If still ambiguous, try matching by key attributes from stored HTML
        var tagMatch = elementHtml.match(/^<(\\w+)/);
        var tagName = tagMatch ? tagMatch[1].toLowerCase() : null;
        if (tagName) {
          for (var j = 0; j < matches.length; j++) {
            if (matches[j].tagName.toLowerCase() === tagName) return matches[j];
          }
        }
      }
      if (matches.length === 1) return matches[0];
    } catch (e) { /* invalid selector, fall through */ }

    // Strategy 2: Scan all elements and match by outerHTML
    if (elementHtml) {
      var normStored = normalizeHtml(elementHtml);
      var allEls = document.querySelectorAll('*');
      for (var k = 0; k < allEls.length; k++) {
        var normEl = normalizeHtml(allEls[k].outerHTML);
        if (normEl === normStored) return allEls[k];
        if (normEl.indexOf(normStored) === 0 || normStored.indexOf(normEl) === 0) return allEls[k];
      }
    }
    return null;
  }

  function applyHighlight(el) {
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
  }

  var _attempt = 0;
  var _retryTimer = null;

  function report(el, selector) {
    var target = visibleTarget(el);
    applyHighlight(target);
    window.parent.postMessage({ type: 'ada-found', selector: selector, hidden: target !== el }, '*');
  }

  function highlight(selector, elementHtml, ruleId) {
    clearHighlight();
    hidePreloaders();
    if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null; }

    // For skip-link-broken: only highlight the skip link itself, not an unrelated element
    if (ruleId === 'skip-link-broken') {
      try {
        var el = document.querySelector(selector) || findElement(selector, elementHtml);
        if (el) {
          report(el, selector);
        } else {
          window.parent.postMessage({ type: 'ada-not-found', selector: selector }, '*');
        }
        return;
      } catch (e) {
        window.parent.postMessage({ type: 'ada-not-found', selector: selector }, '*');
        return;
      }
    }

    var found = findElement(selector, elementHtml);
    if (found) {
      _attempt = 0;
      report(found, selector);
    } else if (_attempt < 16) {
      // Content injected by the site's scripts (widgets, captchas) may appear late
      _attempt++;
      _retryTimer = setTimeout(function () { highlight(selector, elementHtml, ruleId); }, 500);
    } else {
      _attempt = 0;
      window.parent.postMessage({ type: 'ada-not-found', selector: selector }, '*');
    }
  }

  window.addEventListener('message', function (e) {
    if (!e.data) return;
    if (e.data.type === 'ada-highlight') highlight(e.data.selector, e.data.elementHtml, e.data.ruleId);
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
  let finalUrl = targetUrl;
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
    if (res.url) finalUrl = res.url;
  } catch (err) {
    return new Response(JSON.stringify({ error: `Fetch failed: ${String(err)}` }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Strip CSP meta tags so the injected highlight script can run inside the
  // blob-URL iframe (the original site's CSP would otherwise block inline scripts)
  html = html.replace(/<meta[^>]+http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi, "");

  // Inject <base> so relative URLs resolve against the original origin
  const baseHref = finalUrl.replace(/"/g, "%22");
  const baseTag = `<base href="${baseHref}">`;
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
