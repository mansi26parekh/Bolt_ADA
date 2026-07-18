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

const DEV_CSS = `
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1e293b;background:#eef2f8;line-height:1.5;padding:32px 40px;font-size:13px}
a{color:#1d4ed8;text-decoration:none}
/* Header */
.report-header{margin-bottom:24px}
.report-title{font-size:22px;font-weight:800;color:#1d4ed8;margin-bottom:6px}
.report-meta{font-size:12px;color:#475569;line-height:1.8}
.report-meta strong{color:#1e293b;font-weight:600}
/* Summary table */
.summary-section{margin-bottom:28px}
.section-heading{font-size:15px;font-weight:700;color:#1d4ed8;margin-bottom:10px;padding-bottom:4px;border-bottom:2px solid #c7d8f0}
.summary-table{width:100%;border-collapse:collapse;background:#dce8f5;border-radius:8px;overflow:hidden}
.summary-table th{padding:9px 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#475569;background:#d0dfee;text-align:left;border-bottom:1px solid #b8cfe4}
.summary-table td{padding:10px 14px;font-size:15px;font-weight:700;color:#1e293b;border-bottom:1px solid #c7d8f0}
.summary-table tr:last-child td{border-bottom:none}
.c-critical{color:#dc2626}
.c-serious{color:#ea580c}
.c-moderate{color:#d97706}
.c-minor{color:#2563eb}
/* Page-wise section */
.pages-section{margin-bottom:0}
.page-block{margin-bottom:20px;background:#dce8f5;border-radius:10px;overflow:hidden;border:1px solid #b8cfe4}
.page-heading{padding:10px 16px;background:#c7d8f0;border-bottom:1px solid #b8cfe4;display:flex;align-items:baseline;gap:10px}
.page-name{font-size:13px;font-weight:700;color:#1d4ed8}
.page-url{font-size:11px;color:#64748b}
.page-score{margin-left:auto;font-size:12px;font-weight:600}
/* Issues table */
.issues-table{width:100%;border-collapse:collapse}
.issues-table th{padding:8px 12px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;background:#d0dfee;text-align:left;border-bottom:1px solid #b8cfe4}
.issues-table td{padding:9px 12px;font-size:12px;color:#334155;border-bottom:1px solid #c7d8f0;vertical-align:top}
.issues-table tr:last-child td{border-bottom:none}
.issues-table tr:nth-child(even) td{background:#d6e4f2}
/* Severity badges */
.badge{display:inline-block;padding:2px 9px;border-radius:20px;font-size:10px;font-weight:700;color:#fff;white-space:nowrap}
.badge-critical{background:#dc2626}
.badge-serious{background:#ea580c}
.badge-moderate{background:#d97706}
.badge-minor{background:#2563eb}
/* Element code */
.el-code{font-family:"SF Mono",Menlo,Monaco,Consolas,monospace;font-size:10px;color:#475569;background:#c2d5e8;padding:2px 5px;border-radius:4px;display:inline-block;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:middle}
/* Status */
.status-open{display:inline-block;padding:2px 9px;border-radius:20px;font-size:10px;font-weight:600;color:#92400e;background:#fef3c7;border:1px solid #fde68a;white-space:nowrap}
/* Inspect link */
.inspect-link{display:inline-flex;align-items:center;gap:3px;font-size:11px;font-weight:600;color:#1d4ed8;padding:3px 9px;border-radius:5px;border:1px solid #93c5fd;background:#dbeafe;white-space:nowrap}
/* Footer */
.report-footer{margin-top:32px;padding-top:12px;border-top:1px solid #b8cfe4;font-size:10px;color:#94a3b8;text-align:center}
@media print{
  body{padding:16px 20px;background:#eef2f8;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .page-block{break-inside:avoid}
}
`;

export function generateDeveloperReport(scanData: ScanData) {
  const { scan, pages, results } = scanData;

  const counts: Record<ImpactLevel, number> = { critical:0, serious:0, moderate:0, minor:0 };
  results.forEach(r => { counts[r.impact as ImpactLevel]++; });

  const pagesWithIssues = pages.filter(p => p.violation_count > 0);

  const pageSections = pagesWithIssues.map(page => {
    const pageResults = results.filter(r => r.page_id === page.id);

    const rows = pageResults.map(r => {
      const lvl = (r.impact as ImpactLevel) || "moderate";
      const m   = impactMeta[lvl];
      const el  = r.element
        ? r.element.replace(/\s+/g," ").trim().slice(0, 60) + (r.element.length > 60 ? "…" : "")
        : r.selector || "—";
      const fix = suggestedFix(r);
      const inspectUrl = `${page.url}#ada-selector=${encodeURIComponent(r.selector||r.element||"")}`;

      return `<tr>
        <td style="font-weight:600;color:#1e293b">${esc(r.title)}</td>
        <td><span class="badge badge-${lvl}">${m.label}</span></td>
        <td><span class="el-code" title="${esc(el)}">${esc(el)}</span></td>
        <td style="color:#475569">${esc(fix)}</td>
        <td><a href="${esc(inspectUrl)}" class="inspect-link">Inspect Issue ↗</a></td>
        <td><span class="status-open">Open</span></td>
      </tr>`;
    }).join("");

    const scoreVal = page.score ?? null;
    const scoreC   = scoreColor(scoreVal);

    return `<div class="page-block">
      <div class="page-heading">
        <span class="page-name">${esc(page.title || page.url)}</span>
        <span class="page-url">${esc(page.url)}</span>
        <span class="page-score" style="color:${scoreC}">Score: ${scoreVal ?? "N/A"}</span>
      </div>
      <table class="issues-table">
        <thead>
          <tr>
            <th style="width:22%">Issue</th>
            <th style="width:10%">Severity</th>
            <th style="width:20%">Affected Element</th>
            <th style="width:26%">Suggested Fix</th>
            <th style="width:13%">Inspect Issue</th>
            <th style="width:9%">Status</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }).join("");

  const domain = scan.url.replace(/https?:\/\//,"").replace(/\/.*$/,"");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Developer Report — ${esc(domain)}</title>
<style>${DEV_CSS}</style>
</head>
<body>
  <div class="report-header">
    <div class="report-title">ADA Scanner - Developer Report</div>
    <div class="report-meta">
      <strong>Website:</strong> ${esc(domain)}<br>
      <strong>Generated:</strong> ${fmtDate(new Date().toISOString())}<br>
      <strong>Accessibility Score:</strong> ${scan.score ?? "N/A"}/100
    </div>
  </div>

  <div class="summary-section">
    <div class="section-heading">Summary</div>
    <table class="summary-table">
      <thead>
        <tr>
          <th>Pages</th>
          <th>Issues</th>
          <th>Critical</th>
          <th>Serious</th>
          <th>Moderate</th>
          <th>Minor</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${scan.pages_scanned}</td>
          <td>${scan.total_violations}</td>
          <td class="c-critical">${counts.critical}</td>
          <td class="c-serious">${counts.serious}</td>
          <td class="c-moderate">${counts.moderate}</td>
          <td class="c-minor">${counts.minor}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="pages-section">
    <div class="section-heading">Page-wise Issues</div>
    ${pageSections || "<p style='color:#64748b;padding:12px'>No violations detected.</p>"}
  </div>

  <div class="report-footer">
    Generated by ADA Scanner — Developer Report — ${fmtDate(new Date().toISOString())}
  </div>
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
