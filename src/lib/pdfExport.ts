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

export function generateDeveloperReport(scanData: ScanData) {
  const { scan, pages, results } = scanData;
  const counts: Record<ImpactLevel, number> = { critical:0, serious:0, moderate:0, minor:0 };
  results.forEach(r => { counts[r.impact as ImpactLevel]++; });

  const catCounts = results.reduce<Record<string,number>>((a,r) => { a[r.category]=(a[r.category]||0)+1; return a; },{});

  const pageSections = pages
    .filter(p => p.violation_count > 0)
    .map(page => {
      const pr = results.filter(r => r.page_id === page.id);
      const groups: Record<string, ScanResult[]> = {};
      pr.forEach(r => { (groups[r.rule_id] ??= []).push(r); });

      const groupHtml = Object.entries(groups).map(([, grp]) => {
        const lvl = (grp[0].impact as ImpactLevel) || "moderate";
        const m = impactMeta[lvl] || impactMeta.moderate;
        const instances = grp.map((r, i) => {
          const inspectUrl = `${page.url}#ada-selector=${encodeURIComponent(r.selector||"")}`;
          return `<div class="vrow" style="border-left-color:${m.color}">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
              <span class="badge" style="background:${m.color}">${m.label}</span>
              <span class="vtitle">${esc(r.title)} <span style="color:#94a3b8;font-weight:400">— Instance ${i+1}</span></span>
            </div>
            <div class="vdesc">${esc(r.description)}</div>
            ${r.element ? `<code class="vcode">${esc(r.element)}</code>` : ""}
            ${r.selector ? `<div style="font-size:11px;color:#94a3b8;font-family:monospace;margin-bottom:5px">Selector: ${esc(r.selector)}</div>` : ""}
            <a href="${esc(inspectUrl)}" class="inspect">&#128269; Inspect Element</a>
          </div>`;
        }).join("");
        return `<div style="margin-bottom:10px">
          <div style="font-size:12px;font-weight:600;color:#475569;margin-bottom:5px">${esc(grp[0].title)} (${grp.length})</div>
          ${instances}
        </div>`;
      }).join("");

      return `<div class="pg-sec">
        <h3>${esc(page.title||page.url)} <span class="pg-url">— ${esc(page.url)}</span></h3>
        <div style="font-size:11px;color:#64748b;margin-bottom:8px">
          Score: <strong style="color:${scoreColor(page.score)}">${page.score??'N/A'}</strong>
          &nbsp;&nbsp;Violations: <strong style="color:#dc2626">${page.violation_count}</strong>
        </div>
        ${groupHtml}
      </div>`;
    }).join("");

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
    <title>Developer Report — ${esc(scan.url)}</title>
    <style>${BASE_CSS}</style></head><body>
    <div class="hdr">
      <div class="hdr-logo">A</div>
      <div><h1>ADA Accessibility — Developer Report</h1><div class="sub">Technical scan results with inspectable element references</div></div>
    </div>
    ${metaBar(scan)}
    <div class="sec"><h2>Scan Summary</h2>
      ${scoreBox(scan.score)}
      ${severityGrid(counts)}
      <table><thead><tr><th>WCAG Category</th><th>Violations</th></tr></thead><tbody>
        ${Object.entries(catCounts).sort((a,b)=>b[1]-a[1]).map(([c,n])=>`<tr><td>${esc(c)}</td><td>${n}</td></tr>`).join("")}
      </tbody></table>
    </div>
    <div class="sec"><h2>Detailed Issues by Page</h2>
      ${pageSections || "<p style='color:#64748b;font-size:13px'>No violations detected.</p>"}
    </div>
    <div class="footer">Generated by ADA Scanner — Developer Report — ${fmtDate(new Date().toISOString())}</div>
  </body></html>`;

  const slug = scan.url.replace(/https?:\/\//,"").replace(/[^a-z0-9]/gi,"-").slice(0,40);
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
