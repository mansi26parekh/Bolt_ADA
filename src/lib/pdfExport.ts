import type { ScanData, ScanResult } from "./types";

type ImpactLevel = "critical" | "serious" | "moderate" | "minor";

const impactMeta: Record<ImpactLevel, { label: string; color: string }> = {
  critical: { label: "Critical", color: "#dc2626" },
  serious:  { label: "Serious",  color: "#ea580c" },
  moderate: { label: "Moderate", color: "#d97706" },
  minor:    { label: "Minor",    color: "#2563eb" },
};

function esc(s: string): string {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleString("en-US", { year:"numeric", month:"long", day:"numeric", hour:"2-digit", minute:"2-digit" }); }
  catch { return iso; }
}

function scoreLabel(s: number | null) {
  if (s === null) return "N/A";
  if (s >= 90) return "Excellent"; if (s >= 80) return "Good";
  if (s >= 60) return "Needs Work"; if (s >= 40) return "Poor";
  return "Critical";
}

function scoreColor(s: number | null) {
  if (s === null) return "#64748b";
  if (s >= 80) return "#059669"; if (s >= 50) return "#d97706";
  return "#dc2626";
}

function downloadHtml(html: string, filename: string) {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const BASE_CSS = `
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1e293b;background:#f8fafc;line-height:1.6;padding:40px}
.hdr{display:flex;align-items:center;gap:16px;border-bottom:3px solid #2563eb;padding-bottom:20px;margin-bottom:28px}
.hdr-logo{width:44px;height:44px;border-radius:10px;background:#2563eb;color:#fff;font-size:22px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.hdr h1{font-size:20px;font-weight:700;color:#0f172a}
.hdr .sub{font-size:12px;color:#64748b;margin-top:2px}
.meta{display:flex;gap:20px;flex-wrap:wrap;padding:14px 18px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:28px;font-size:12px;color:#64748b}
.meta strong{color:#1e293b}
.sec{margin-bottom:28px}
.sec h2{font-size:15px;font-weight:700;color:#0f172a;margin-bottom:14px;padding-bottom:8px;border-bottom:2px solid #e2e8f0}
.score-box{display:inline-flex;flex-direction:column;align-items:center;padding:20px 32px;border-radius:14px;border:2px solid;margin-bottom:18px}
.score-val{font-size:40px;font-weight:800;line-height:1}
.score-lbl{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;margin-top:4px}
.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px}
.card{padding:14px;border-radius:10px;border:1px solid #e2e8f0;background:#fff}
.card-val{font-size:26px;font-weight:700}
.card-lbl{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.04em;margin-top:2px}
table{width:100%;border-collapse:collapse}
th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#64748b;padding:8px 10px;border-bottom:2px solid #e2e8f0}
td{padding:9px 10px;border-bottom:1px solid #f1f5f9;font-size:12px;vertical-align:top}
.badge{display:inline-block;padding:2px 8px;border-radius:5px;font-size:10px;font-weight:600;color:#fff;white-space:nowrap}
.pg-sec{margin-bottom:22px;break-inside:avoid}
.pg-sec h3{font-size:13px;font-weight:600;color:#1e293b;margin-bottom:10px}
.pg-url{font-size:11px;color:#64748b;font-weight:400}
.vrow{padding:10px 14px;border-radius:8px;border:1px solid #e2e8f0;border-left:4px solid;background:#fff;margin-bottom:7px}
.vtitle{font-size:13px;font-weight:600;color:#1e293b}
.vdesc{font-size:12px;color:#475569;margin:4px 0}
.vcode{font-family:"SF Mono",Monaco,Consolas,monospace;font-size:10px;color:#64748b;background:#f1f5f9;padding:5px 8px;border-radius:5px;display:block;margin-bottom:5px;word-break:break-all;max-height:56px;overflow:hidden}
.inspect{display:inline-flex;align-items:center;gap:3px;font-size:11px;font-weight:600;color:#2563eb;text-decoration:none;padding:2px 9px;border-radius:5px;border:1px solid #bfdbfe;background:#eff6ff}
.rec{padding:11px 15px;border-radius:8px;background:#eff6ff;border:1px solid #bfdbfe;margin-bottom:8px}
.rec-t{font-size:13px;font-weight:600;color:#1e40af;margin-bottom:3px}
.rec-d{font-size:12px;color:#475569}
.concl{padding:18px 22px;border-radius:10px;background:#fff;border:1px solid #e2e8f0;font-size:13px;color:#475569;line-height:1.7}
.footer{margin-top:36px;padding-top:14px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;text-align:center}
@media print{body{padding:20px}.pg-sec{break-inside:avoid}}
`;

function metaBar(scan: ScanData["scan"]) {
  return `<div class="meta">
    <span><strong>URL:</strong> ${esc(scan.url)}</span>
    <span><strong>Date:</strong> ${fmtDate(scan.created_at)}</span>
    <span><strong>Pages:</strong> ${scan.pages_scanned}</span>
    <span><strong>Violations:</strong> ${scan.total_violations}</span>
  </div>`;
}

function scoreBox(score: number | null) {
  const c = scoreColor(score);
  return `<div class="score-box" style="border-color:${c}">
    <span class="score-val" style="color:${c}">${score ?? "--"}</span>
    <span class="score-lbl">${scoreLabel(score)}</span>
  </div>`;
}

function severityGrid(counts: Record<ImpactLevel, number>) {
  return `<div class="grid4">${(Object.keys(impactMeta) as ImpactLevel[]).map(lvl => {
    const m = impactMeta[lvl];
    return `<div class="card" style="border-left:4px solid ${m.color}">
      <div class="card-val" style="color:${m.color}">${counts[lvl]}</div>
      <div class="card-lbl">${m.label}</div>
    </div>`;
  }).join("")}</div>`;
}

// Map common axe rule IDs to actionable developer fix suggestions
const RULE_FIXES: Record<string, string> = {
  "image-alt": "Add descriptive alt attribute to <img> element",
  "label": "Associate a <label> with the form control using for/id or aria-label",
  "color-contrast": "Increase text-to-background color contrast ratio to ≥ 4.5:1",
  "link-name": "Add descriptive text or aria-label to the anchor element",
  "button-name": "Add visible text or aria-label to the button element",
  "html-has-lang": "Add lang attribute to <html> element (e.g. lang=\"en\")",
  "document-title": "Add a descriptive <title> element inside <head>",
  "frame-title": "Add a title attribute to all <iframe> and <frame> elements",
  "duplicate-id": "Ensure all id attribute values are unique within the document",
  "aria-roles": "Use a valid WAI-ARIA role value on the element",
  "aria-required-attr": "Add all required ARIA attributes for this role",
  "aria-valid-attr-value": "Fix the ARIA attribute value to match the expected type",
  "landmark-one-main": "Add a <main> landmark to the page structure",
  "region": "Wrap content in landmark regions (main, nav, header, footer)",
  "skip-link": "Add a skip-navigation link as the first focusable element",
  "tabindex": "Remove tabindex > 0; use tabindex=\"0\" or \"-1\" only",
  "heading-order": "Use heading levels in sequential order (h1→h2→h3…)",
  "list": "Ensure list children are only <li>, <script>, or <template> elements",
  "listitem": "Place <li> elements only inside <ul> or <ol>",
  "td-headers-attr": "Ensure all td headers attributes reference existing th ids",
  "th-has-data-cells": "Ensure each <th> has associated data cells",
  "select-name": "Add aria-label or <label> to <select> element",
  "input-image-alt": "Add alt attribute to <input type=\"image\">",
  "object-alt": "Add body text or title attribute to <object> element",
  "video-caption": "Add captions track to <video> element",
  "audio-caption": "Add captions or transcript to <audio> element",
  "meta-refresh": "Do not use <meta http-equiv=\"refresh\"> for automatic redirects",
  "meta-viewport": "Remove user-scalable=no from viewport meta tag",
  "focus-order-semantics": "Ensure interactive elements receive focus in a logical order",
  "scrollable-region-focusable": "Make scrollable region focusable with tabindex=\"0\"",
};

function suggestedFix(result: ScanResult): string {
  if (RULE_FIXES[result.rule_id]) return RULE_FIXES[result.rule_id];
  // Fallback: strip the axe description prefix and return it
  const d = result.description || "";
  return d.length > 90 ? d.slice(0, 87) + "…" : d || "Review and remediate per WCAG guidelines";
}

export function generateDeveloperReport(scanData: ScanData) {
  const { scan, pages, results } = scanData;

  const counts: Record<ImpactLevel, number> = { critical:0, serious:0, moderate:0, minor:0 };
  results.forEach(r => {
    const k = r.impact as ImpactLevel;
    if (k in counts) counts[k]++;
  });
  const totalIssues = counts.critical + counts.serious + counts.moderate + counts.minor;
  const totalPagesScanned = pages.length || scan.pages_scanned;

  // Derive pages from actual results (robust against stale violation_count)
  const pageMap = new Map<string, { url: string; title: string; score: number | null; count: number; rows: any[] }>();
  const pageById = new Map(pages.map(p => [p.id, p]));
  results.forEach(r => {
    let entry = pageMap.get(r.page_id);
    if (!entry) {
      const pg = pageById.get(r.page_id);
      entry = {
        url:   pg?.url || "",
        title: pg?.title || pg?.url || r.page_id,
        score: pg?.score ?? null,
        count: 0,
        rows: [],
      };
      pageMap.set(r.page_id, entry);
    }
    const lvl = (r.impact as ImpactLevel) || "moderate";
    const el = r.element ? r.element.replace(/\s+/g," ").trim() : r.selector || "";
    entry.rows.push({
      title:    r.title,
      impact:   lvl,
      el,
      selector: r.selector || "",
      desc:     r.description || "",
      fix:      suggestedFix(r),
      pageUrl:  entry.url,
    });
    entry.count++;
  });
  const pagesWithIssues = Array.from(pageMap.values()).filter(p => p.url);
  const domain = scan.url.replace(/https?:\/\//,"").replace(/\/.*$/,"");
  const totalPages = pagesWithIssues.length;

  // Build page data for the inspect modal
  const pageData = pagesWithIssues.map(page => ({
    url:    page.url,
    title:  page.title,
    score:  page.score,
    count:  page.count,
    rows:   page.rows,
  }));

  const pageDataJson = JSON.stringify(pageData)
    .replace(/</g,"\\u003c").replace(/>/g,"\\u003e").replace(/&/g,"\\u0026");

  // Pre-render all page blocks as static HTML (visible without JavaScript)
  const scoreColorTs = (s: number | null): string => {
    if (s === null || s === undefined) return "#64748b";
    if (s >= 80) return "#059669"; if (s >= 50) return "#d97706"; return "#dc2626";
  };

  const pagesHtml = pagesWithIssues.map((page, pi) => {
    const idx = pi + 1;
    const sc = page.score;
    const scColor = scoreColorTs(sc);
    const scTxt = sc !== null && sc !== undefined ? `${sc}/100` : "N/A";

    const rowsHtml = page.rows.map((r, ri) => {
      const lvl = r.impact;
      const lbl = impactMeta[lvl]?.label || lvl;
      const elShort = r.el ? (r.el.length > 80 ? r.el.slice(0, 80) + "\u2026" : r.el) : "\u2014";
      return `<tr>
        <td style="font-weight:600;color:#1e293b">${esc(r.title)}</td>
        <td><span class="badge badge-${lvl}">${lbl}</span></td>
        <td><span class="el-code" title="${esc(r.el)}">${esc(elShort)}</span></td>
        <td style="color:#475569">${esc(r.fix)}</td>
        <td><a class="inspect-btn" href="${esc(page.url)}" target="_blank" rel="noopener" data-p="${pi}" data-r="${ri}"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg> Inspect</a></td>
        <td><span class="status-open">Open</span></td>
      </tr>`;
    }).join("");

    return `<div class="page-block">
      <div class="page-head">
        <div class="page-num">${idx}</div>
        <div class="page-info">
          <a class="page-url-link" href="${esc(page.url)}" target="_blank">${esc(page.url)}</a>
          <a class="page-title-link" href="${esc(page.url)}" target="_blank">${esc(page.title)}</a>
        </div>
        <div class="page-badges">
          <span class="issues-count">${page.count} issue${page.count !== 1 ? "s" : ""}</span>
          <span class="score-badge" style="color:${scColor};border-color:${scColor};background:${scColor}18">${scTxt}</span>
        </div>
      </div>
      <div class="issues-wrap">
        <table class="issues-table"><thead><tr>
          <th style="width:21%">Issue</th>
          <th style="width:10%">Severity</th>
          <th style="width:21%">Affected Element</th>
          <th style="width:27%">Suggested Fix</th>
          <th style="width:12%">Inspect Issue</th>
          <th style="width:9%">Status</th>
        </tr></thead><tbody>${rowsHtml}</tbody></table>
      </div>
    </div>`;
  }).join("") || "<p style='color:#64748b;padding:12px'>No violations detected.</p>";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Developer Report — ${esc(domain)}</title>
<style>
:root{
  --bg:#edf2f9;--surface:#ffffff;--surface2:#f1f6fc;--border:#d0dcea;
  --blue:#1d4ed8;--blue-light:#dbeafe;--blue-mid:#bfdbfe;
  --text:#1e293b;--muted:#64748b;--faint:#94a3b8;
  --critical:#dc2626;--serious:#ea580c;--moderate:#d97706;--minor:#2563eb;
}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
     background:var(--bg);color:var(--text);font-size:13px;line-height:1.6;min-height:100vh}
a{color:var(--blue);text-decoration:none}

/* ── Top bar ── */
.topbar{background:linear-gradient(135deg,#1e3a8a 0%,#2563eb 100%);
        padding:20px 36px;display:flex;align-items:center;justify-content:space-between;
        box-shadow:0 4px 20px rgba(37,99,235,.25)}
.topbar-left{display:flex;align-items:center;gap:14px}
.logo{width:40px;height:40px;border-radius:10px;background:rgba(255,255,255,.2);
      backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;
      font-size:20px;font-weight:900;color:#fff;border:1px solid rgba(255,255,255,.3)}
.topbar h1{font-size:18px;font-weight:700;color:#fff;letter-spacing:-.3px}
.topbar .sub{font-size:11px;color:rgba(255,255,255,.65);margin-top:1px}
.score-pill{background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.3);
            border-radius:40px;padding:6px 18px;color:#fff;font-size:13px;font-weight:600;
            display:flex;align-items:center;gap:8px;backdrop-filter:blur(4px)}
.score-num{font-size:22px;font-weight:800}

/* ── Wrapper ── */
.wrap{max-width:1200px;margin:0 auto;padding:28px 36px 48px}

/* ── Meta row ── */
.meta-row{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:24px}
.meta-chip{background:var(--surface);border:1px solid var(--border);border-radius:8px;
           padding:8px 16px;font-size:12px;color:var(--muted);display:flex;align-items:center;gap:6px}
.meta-chip strong{color:var(--text);font-weight:600}

/* ── Section heading ── */
.sec-head{font-size:16px;font-weight:700;color:var(--blue);
          margin-bottom:14px;display:flex;align-items:center;gap:8px}
.sec-head::after{content:"";flex:1;height:2px;background:linear-gradient(90deg,var(--blue-mid),transparent)}

/* ── Summary cards ── */
.summary-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:30px}
.s-card{background:var(--surface);border:1px solid var(--border);border-radius:10px;
        padding:14px 12px;text-align:center;position:relative;overflow:hidden;
        transition:transform .15s,box-shadow .15s}
.s-card:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(0,0,0,.08)}
.s-card::before{content:"";position:absolute;top:0;left:0;right:0;height:3px}
.s-card.c-pages::before{background:var(--blue)}
.s-card.c-issues::before{background:#7c3aed}
.s-card.c-critical::before{background:var(--critical)}
.s-card.c-serious::before{background:var(--serious)}
.s-card.c-moderate::before{background:var(--moderate)}
.s-card.c-minor::before{background:var(--minor)}
.s-val{font-size:28px;font-weight:800;line-height:1;margin-bottom:4px}
.s-lbl{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)}

/* ── Pages section ── */
.pages-section{margin-bottom:0}

/* ── Page block ── */
.page-block{background:var(--surface);border:1px solid var(--border);border-radius:12px;
            margin-bottom:16px;overflow:hidden;
            box-shadow:0 2px 8px rgba(0,0,0,.04);transition:box-shadow .2s}
.page-block:hover{box-shadow:0 4px 16px rgba(0,0,0,.09)}

.page-head{padding:13px 18px;background:linear-gradient(90deg,#f0f6ff 0%,#f8fbff 100%);
           border-bottom:1px solid var(--border);display:flex;align-items:center;gap:0;flex-wrap:wrap}
.page-num{width:26px;height:26px;border-radius:50%;background:var(--blue);color:#fff;
          font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;
          flex-shrink:0;margin-right:12px}
.page-info{flex:1;min-width:0}
.page-url-link{font-size:12px;color:var(--muted);font-family:"SF Mono",Menlo,Monaco,monospace;
               display:block;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
               transition:color .15s}
.page-url-link:hover{color:var(--blue);text-decoration:underline}
.page-title-link{font-size:13px;font-weight:700;color:var(--blue);display:block;
                 white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:opacity .15s}
.page-title-link:hover{opacity:.75;text-decoration:underline}
.page-badges{display:flex;align-items:center;gap:8px;margin-left:auto;flex-shrink:0;padding-left:12px}
.issues-count{font-size:12px;font-weight:700;color:#fff;background:var(--critical);
              padding:3px 10px;border-radius:20px}
.score-badge{font-size:12px;font-weight:600;padding:3px 10px;border-radius:20px;border:1px solid}

/* ── Issues table ── */
.issues-wrap{overflow-x:auto}
.issues-table{width:100%;border-collapse:collapse;min-width:700px}
.issues-table thead th{padding:9px 14px;font-size:10px;font-weight:700;text-transform:uppercase;
                        letter-spacing:.07em;color:var(--muted);background:var(--surface2);
                        text-align:left;border-bottom:1px solid var(--border);white-space:nowrap}
.issues-table tbody tr{transition:background .12s}
.issues-table tbody tr:hover td{background:#f0f6ff}
.issues-table tbody td{padding:10px 14px;font-size:12px;color:#334155;
                        border-bottom:1px solid #f1f5f9;vertical-align:top}
.issues-table tbody tr:last-child td{border-bottom:none}
.issues-table tbody tr:nth-child(even) td{background:#fafcff}

/* ── Badges ── */
.badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:10px;font-weight:700;
       color:#fff;white-space:nowrap;letter-spacing:.03em}
.badge-critical{background:var(--critical)}
.badge-serious{background:var(--serious)}
.badge-moderate{background:var(--moderate)}
.badge-minor{background:var(--minor)}

/* ── Element code ── */
.el-code{font-family:"SF Mono",Menlo,Monaco,Consolas,monospace;font-size:10px;color:#475569;
         background:#e8f0fb;padding:3px 7px;border-radius:5px;display:block;
         max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
         border:1px solid #ccdaf5;cursor:default}

/* ── Inspect button ── */
.inspect-btn{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;
            color:var(--blue);padding:4px 10px;border-radius:6px;border:1px solid var(--blue-mid);
            background:var(--blue-light);white-space:nowrap;cursor:pointer;
            transition:background .15s,transform .1s;font-family:inherit;text-decoration:none}
.inspect-btn:hover{background:#bfdbfe;transform:translateY(-1px)}
.inspect-btn svg{width:12px;height:12px;stroke:currentColor;fill:none;stroke-width:2;
                stroke-linecap:round;stroke-linejoin:round}

/* ── Modal ── */
.modal-overlay{position:fixed;inset:0;background:rgba(15,23,42,.55);backdrop-filter:blur(3px);
               display:none;align-items:center;justify-content:center;z-index:1000;padding:20px}
.modal-overlay.show{display:flex;animation:fadeIn .15s ease}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
.modal{background:var(--surface);border-radius:14px;max-width:560px;width:100%;
       box-shadow:0 24px 60px rgba(0,0,0,.3);overflow:hidden;animation:slideUp .2s ease}
@keyframes slideUp{from{transform:translateY(16px);opacity:0}to{transform:translateY(0);opacity:1}}
.modal-head{padding:16px 20px;background:linear-gradient(135deg,#1e3a8a,#2563eb);color:#fff;
            display:flex;align-items:center;justify-content:space-between}
.modal-head h3{font-size:15px;font-weight:700}
.modal-close{background:rgba(255,255,255,.2);border:none;color:#fff;width:28px;height:28px;
             border-radius:50%;cursor:pointer;font-size:16px;display:flex;align-items:center;
             justify-content:center;transition:background .15s}
.modal-close:hover{background:rgba(255,255,255,.35)}
.modal-body{padding:20px}
.modal-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
             color:var(--muted);margin-bottom:6px;margin-top:14px}
.modal-label:first-child{margin-top:0}
.modal-desc{font-size:12px;color:#475569;line-height:1.6}
.code-block{font-family:"SF Mono",Menlo,Monaco,Consolas,monospace;font-size:11px;color:#1e293b;
            background:#f1f6fc;border:1px solid var(--border);border-radius:8px;
            padding:10px 12px;white-space:pre-wrap;word-break:break-all;line-height:1.5;
            position:relative}
.copy-btn{position:absolute;top:8px;right:8px;background:var(--blue);color:#fff;border:none;
          padding:4px 10px;border-radius:5px;font-size:10px;font-weight:600;cursor:pointer;
          font-family:inherit;transition:background .15s}
.copy-btn:hover{background:#1e40af}
.copy-btn.copied{background:#059669}
.modal-actions{display:flex;gap:10px;margin-top:18px}
.modal-btn{flex:1;padding:10px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;
           border:1px solid var(--border);background:var(--surface);color:var(--text);
           transition:all .15s;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:6px}
.modal-btn:hover{background:var(--surface2)}
.modal-btn.primary{background:var(--blue);color:#fff;border-color:var(--blue)}
.modal-btn.primary:hover{background:#1e40af}
.modal-hint{font-size:11px;color:var(--blue);margin-top:12px;padding:8px 12px;
             background:var(--blue-light);border-radius:8px;border:1px solid var(--blue-mid);
             line-height:1.5;display:none}
.modal-hint:not(:empty){display:block}

/* ── Status ── */
.status-open{display:inline-block;padding:3px 10px;border-radius:20px;font-size:10px;
             font-weight:600;color:#92400e;background:#fef3c7;border:1px solid #fde68a}

/* ── Pagination ── */
.pagination{display:flex;align-items:center;justify-content:space-between;
            background:var(--surface);border:1px solid var(--border);border-radius:12px;
            padding:14px 20px;margin-top:20px}
.page-info-text{font-size:13px;color:var(--muted)}
.page-info-text strong{color:var(--text)}
.pag-btns{display:flex;gap:8px;align-items:center}
.pag-btn{padding:7px 18px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;
         border:1px solid var(--border);background:var(--surface);color:var(--text);
         transition:all .15s;display:flex;align-items:center;gap:5px}
.pag-btn:hover:not(:disabled){background:var(--blue);color:#fff;border-color:var(--blue)}
.pag-btn:disabled{opacity:.4;cursor:not-allowed}
.pag-btn.primary{background:var(--blue);color:#fff;border-color:var(--blue)}
.pag-btn.primary:hover:not(:disabled){background:#1e40af}
.pag-dots{display:flex;gap:6px;align-items:center}
.dot{width:8px;height:8px;border-radius:50%;background:var(--border);cursor:pointer;transition:background .15s}
.dot.active{background:var(--blue)}

/* ── Footer ── */
.footer{margin-top:36px;padding-top:16px;border-top:1px solid var(--border);
        font-size:11px;color:var(--faint);text-align:center}
</style>
</head>
<body>

<div class="topbar">
  <div class="topbar-left">
    <div class="logo">A</div>
    <div>
      <div class="topbar h1" style="font-size:18px;font-weight:700;color:#fff">ADA Scanner — Developer Report</div>
      <div class="sub">Technical accessibility audit with inspectable element references</div>
    </div>
  </div>
  <div class="score-pill">
    <span>Score</span>
    <span class="score-num">${scan.score ?? "—"}</span>
    <span style="opacity:.7">/100</span>
  </div>
</div>

<div class="wrap">
  <div class="meta-row">
    <div class="meta-chip"><strong>Website:</strong> ${esc(domain)}</div>
    <div class="meta-chip"><strong>Generated:</strong> ${fmtDate(new Date().toISOString())}</div>
    <div class="meta-chip"><strong>Pages Scanned:</strong> ${totalPagesScanned}</div>
    <div class="meta-chip"><strong>Pages with Issues:</strong> ${totalPages}</div>
  </div>

  <div class="sec-head">Summary</div>
  <div class="summary-grid">
    <div class="s-card c-pages"><div class="s-val" style="color:var(--blue)">${totalPagesScanned}</div><div class="s-lbl">Pages</div></div>
    <div class="s-card c-issues"><div class="s-val" style="color:#7c3aed">${totalIssues}</div><div class="s-lbl">Issues</div></div>
    <div class="s-card c-critical"><div class="s-val" style="color:var(--critical)">${counts.critical}</div><div class="s-lbl">Critical</div></div>
    <div class="s-card c-serious"><div class="s-val" style="color:var(--serious)">${counts.serious}</div><div class="s-lbl">Serious</div></div>
    <div class="s-card c-moderate"><div class="s-val" style="color:var(--moderate)">${counts.moderate}</div><div class="s-lbl">Moderate</div></div>
    <div class="s-card c-minor"><div class="s-val" style="color:var(--minor)">${counts.minor}</div><div class="s-lbl">Minor</div></div>
  </div>

  <div class="sec-head">Page-wise Issues</div>
  <div class="pages-section">${pagesHtml}</div>

  <div class="footer">
    Generated by ADA Scanner &mdash; Developer Report &mdash; ${fmtDate(new Date().toISOString())}
  </div>
</div>

<div class="modal-overlay" id="inspect-modal">
  <div class="modal">
    <div class="modal-head">
      <h3 id="modal-title">Inspect Issue</h3>
      <button class="modal-close" id="modal-close">&times;</button>
    </div>
    <div class="modal-body">
      <div class="modal-label">Issue</div>
      <div class="modal-desc" id="modal-issue"></div>
      <div class="modal-label">Description</div>
      <div class="modal-desc" id="modal-desc"></div>
      <div class="modal-label">CSS Selector</div>
      <div class="code-block" id="modal-selector"></div>
      <div class="modal-label">DevTools Console Command</div>
      <div class="code-block" id="modal-cmd"></div>
      <div class="modal-actions">
        <button class="modal-btn" id="btn-open-page">Open Page &rarr;</button>
        <button class="modal-btn primary" id="btn-highlight">Highlight on Page</button>
      </div>
      <div class="modal-hint" id="modal-hint"></div>
    </div>
  </div>
</div>

<script>
(function(){
  var DATA = ${pageDataJson};
  var currentIssue = null;
  var modal = document.getElementById('inspect-modal');
  if(!modal) return;
  var hintEl = document.getElementById('modal-hint');

  function esc(s){
    return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  function buildCmd(sel){
    if(!sel) return "document.body";
    var s = sel.replace(/'/g,"\\'");
    return "var el=document.querySelector('"+s+"');if(el){el.style.outline='4px solid #dc2626';el.style.outlineOffset='2px';el.scrollIntoView({behavior:'smooth',block:'center'});console.log('ADA Scanner: element highlighted',el);}else{console.warn('ADA Scanner: element not found for selector: "+s+"');}";
  }

  function clip(text){
    var ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);
    ta.select();try{document.execCommand('copy');}catch(e){}document.body.removeChild(ta);
  }

  function openInspect(pi,ri){
    var p=DATA[pi];if(!p)return;
    var r=p.rows[ri];if(!r)return;
    currentIssue=r;
    document.getElementById('modal-title').textContent=r.title||'Inspect Issue';
    document.getElementById('modal-issue').textContent=r.title||'\u2014';
    document.getElementById('modal-desc').textContent=r.desc||'No description available.';
    var sel=r.selector||r.el||'No selector available';
    document.getElementById('modal-selector').innerHTML='<button class="copy-btn" data-copy="modal-selector">Copy</button>'+esc(sel);
    var cmd=buildCmd(r.selector||r.el||'');
    document.getElementById('modal-cmd').innerHTML='<button class="copy-btn" data-copy="modal-cmd">Copy</button>'+esc(cmd);
    if(hintEl) hintEl.textContent='';
    modal.classList.add('show');
    document.body.style.overflow='hidden';
  }

  function closeModal(){
    modal.classList.remove('show');
    document.body.style.overflow='';
  }

  document.addEventListener('click',function(e){
    var ib=e.target.closest('.inspect-btn');
    if(ib&&ib.dataset.p!==undefined){
      e.preventDefault();openInspect(+ib.dataset.p,+ib.dataset.r);return;
    }
    var cb=e.target.closest('[data-copy]');
    if(cb){
      var el=document.getElementById(cb.dataset.copy);
      clip(el.textContent.replace(/^Copy/,'').trim());
      cb.textContent='Copied!';cb.classList.add('copied');
      setTimeout(function(){cb.textContent='Copy';cb.classList.remove('copied');},1500);return;
    }
    if(e.target.id==='modal-close'||e.target===modal){closeModal();return;}
    if(e.target.closest('#btn-open-page')){
      if(currentIssue&&currentIssue.pageUrl) window.open(currentIssue.pageUrl,'_blank');return;
    }
    var hl=e.target.closest('#btn-highlight');
    if(hl){
      if(!currentIssue)return;
      var sel=currentIssue.selector||currentIssue.el||'';
      var cmd=buildCmd(sel);
      var url=currentIssue.pageUrl;
      var w;
      try{w=window.open(url,'_blank');}catch(ex){w=null;}
      if(!w){clip(cmd);if(hintEl)hintEl.textContent='Popup blocked. Command copied \u2014 paste in DevTools console (F12) on the page.';return;}
      var done=false;
      setTimeout(function(){
        if(done)return;done=true;
        try{
          var el=w.document.querySelector(sel);
          if(el){el.style.outline='4px solid #dc2626';el.style.outlineOffset='2px';el.scrollIntoView({behavior:'smooth',block:'center'});}
          if(hintEl)hintEl.textContent='Element highlighted on the page.';
        }catch(ex){
          clip(cmd);
          if(hintEl)hintEl.textContent='Cross-origin page. Command copied \u2014 press F12 on the opened page, paste in Console, hit Enter.';
        }
      },2500);
      return;
    }
  });

  document.addEventListener('keydown',function(e){
    if(e.key==='Escape'&&modal.classList.contains('show'))closeModal();
  });
})();
</script>
</body>
</html>`;

  const slug = domain.replace(/[^a-z0-9]/gi,"-").slice(0,40);
  downloadHtml(html, `developer-report-${slug}.html`);
}

export function generateClientReport(scanData: ScanData) {
  const { scan, results } = scanData;
  const counts: Record<ImpactLevel, number> = { critical:0, serious:0, moderate:0, minor:0 };
  results.forEach(r => { counts[r.impact as ImpactLevel]++; });

  const totalChecks = scan.total_violations + scan.total_passes;
  const compliancePct = totalChecks > 0 ? Math.round((scan.total_passes / totalChecks) * 100) : 0;

  const recs: {title:string;desc:string}[] = [];
  if (counts.critical > 0) recs.push({ title:"Address Critical Accessibility Barriers", desc:`${counts.critical} critical issue${counts.critical!==1?"s":""} prevent users with disabilities from accessing key functionality. These must be resolved immediately.` });
  if (counts.serious > 0) recs.push({ title:"Fix Serious Accessibility Issues", desc:`${counts.serious} serious issue${counts.serious!==1?"s":""} significantly impact users relying on assistive technologies. Prioritize these next.` });
  if (counts.moderate + counts.minor > 0) recs.push({ title:"Improve Moderate and Minor Issues", desc:`${counts.moderate+counts.minor} moderate/minor issue${counts.moderate+counts.minor!==1?"s":""} affect usability and should be addressed in ongoing accessibility maintenance.` });
  recs.push({ title:"Implement Regular Accessibility Audits", desc:"Schedule periodic scans to catch new issues as content and features evolve." });

  const s = scan.score ?? 0;
  const conclusion = s>=90
    ? "Your website demonstrates excellent accessibility practices and is largely compliant with WCAG standards. Minor refinements will help maintain this high standard."
    : s>=80 ? "Your website shows good accessibility with some areas for improvement. Addressing the identified issues will bring the site closer to full compliance."
    : s>=60 ? "Your website has moderate accessibility but requires meaningful work to meet compliance standards. We recommend prioritizing critical and serious issues."
    : s>=40 ? "Your website has significant accessibility barriers. Immediate action is needed to ensure equal access for all users."
    : "Your website has critical accessibility deficiencies requiring urgent remediation. Users with disabilities may be unable to access key functionality.";

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
    <title>Client Report — ${esc(scan.url)}</title>
    <style>${BASE_CSS}</style></head><body>
    <div class="hdr">
      <div class="hdr-logo">A</div>
      <div><h1>ADA Accessibility — Executive Summary</h1><div class="sub">Prepared for ${esc(scan.url)}</div></div>
    </div>
    ${metaBar(scan)}
    <div class="sec"><h2>Accessibility Score</h2>
      ${scoreBox(scan.score)}
      <p style="font-size:13px;color:#475569">The overall accessibility score is <strong>${scoreLabel(scan.score)}</strong>. This reflects how well the website conforms to WCAG (Web Content Accessibility Guidelines) standards.</p>
    </div>
    <div class="sec"><h2>Compliance Summary</h2>
      <div class="grid4">
        <div class="card" style="border-left:4px solid #2563eb"><div class="card-val" style="color:#2563eb">${compliancePct}%</div><div class="card-lbl">Compliance Rate</div></div>
        <div class="card" style="border-left:4px solid #dc2626"><div class="card-val" style="color:#dc2626">${scan.total_violations}</div><div class="card-lbl">Total Issues</div></div>
        <div class="card" style="border-left:4px solid #059669"><div class="card-val" style="color:#059669">${scan.total_passes}</div><div class="card-lbl">Checks Passed</div></div>
        <div class="card" style="border-left:4px solid #64748b"><div class="card-val" style="color:#64748b">${scan.pages_scanned}</div><div class="card-lbl">Pages Tested</div></div>
      </div>
    </div>
    <div class="sec"><h2>Severity Overview</h2>
      ${severityGrid(counts)}
      <table><thead><tr><th>Severity</th><th>Count</th><th>Description</th></tr></thead><tbody>
        <tr><td><span class="badge" style="background:#dc2626">Critical</span></td><td>${counts.critical}</td><td>Prevents access to core functionality</td></tr>
        <tr><td><span class="badge" style="background:#ea580c">Serious</span></td><td>${counts.serious}</td><td>Major barriers for assistive technology users</td></tr>
        <tr><td><span class="badge" style="background:#d97706">Moderate</span></td><td>${counts.moderate}</td><td>Partial barriers affecting usability</td></tr>
        <tr><td><span class="badge" style="background:#2563eb">Minor</span></td><td>${counts.minor}</td><td>Minor inconveniences for some users</td></tr>
      </tbody></table>
    </div>
    <div class="sec"><h2>Recommendations</h2>
      ${recs.map(r=>`<div class="rec"><div class="rec-t">${esc(r.title)}</div><div class="rec-d">${esc(r.desc)}</div></div>`).join("")}
    </div>
    <div class="sec"><h2>Conclusion</h2><div class="concl">${esc(conclusion)}</div></div>
    <div class="footer">Generated by ADA Scanner — Executive Summary — ${fmtDate(new Date().toISOString())}</div>
  </body></html>`;

  const slug = scan.url.replace(/https?:\/\//,"").replace(/[^a-z0-9]/gi,"-").slice(0,40);
  downloadHtml(html, `client-report-${slug}.html`);
}
