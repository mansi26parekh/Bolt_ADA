import { useState, useMemo } from "react";
import {
  Shield,
  ArrowLeft,
  AlertTriangle,
  AlertOctagon,
  AlertCircle,
  Info,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Globe,
  BarChart3,
  FileText,
  CheckCircle2,
  XCircle,
  ScanSearch,
  Download,
  Wrench,
} from "lucide-react";
import type { ScanData, ScanResult } from "../lib/types";
import { PreviewModal } from "./InspectPanel";
import { generateDeveloperReport } from "../lib/pdfExport";

// Lightweight HTML syntax highlighter — colors tags, attributes, strings, comments.
const TAG_COLORS: Record<string, string> = {
  html: "text-red-400", head: "text-red-400", body: "text-red-400",
  div: "text-rose-400", span: "text-rose-400", p: "text-rose-400",
  a: "text-blue-400", img: "text-emerald-400", input: "text-emerald-400",
  button: "text-amber-400", label: "text-amber-400",
  h1: "text-purple-400", h2: "text-purple-400", h3: "text-purple-400",
  h4: "text-purple-400", h5: "text-purple-400", h6: "text-purple-400",
  ul: "text-cyan-400", ol: "text-cyan-400", li: "text-cyan-400",
  table: "text-cyan-400", tr: "text-cyan-400", td: "text-cyan-400", th: "text-cyan-400",
  form: "text-amber-400", select: "text-amber-400", option: "text-amber-400",
  textarea: "text-amber-400", fieldset: "text-amber-400", legend: "text-amber-400",
  nav: "text-sky-400", header: "text-sky-400", footer: "text-sky-400",
  main: "text-sky-400", section: "text-sky-400", article: "text-sky-400",
  aside: "text-sky-400",
  svg: "text-teal-400", path: "text-teal-400", circle: "text-teal-400",
  iframe: "text-orange-400", video: "text-orange-400", audio: "text-orange-400",
  script: "text-yellow-400", style: "text-yellow-400", link: "text-yellow-400",
  meta: "text-yellow-400", title: "text-yellow-400",
};

function HighlightedHtml({ html }: { html: string }) {
  const tokens: React.ReactNode[] = [];
  const regex = /(<!--[\s\S]*?-->)|(<\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?>)|("[^"]*"|'[^']*')|([^<]+)/g;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = regex.exec(html)) !== null) {
    if (m[1]) {
      tokens.push(<span key={key++} className="text-slate-500 italic">{m[1]}</span>);
    } else if (m[2]) {
      const slash = m[2];
      const tag = m[3].toLowerCase();
      const attrs = m[4];
      const close = m[5];
      const tagColor = TAG_COLORS[tag] || "text-pink-400";
      tokens.push(<span key={key++} className="text-slate-500">{slash}</span>);
      tokens.push(<span key={key++} className={tagColor}>{tag}</span>);
      if (attrs) {
        const attrRegex = /\s([a-zA-Z_:][\w:-]*)(=("[^"]*"|'[^']*'))?/g;
        let am: RegExpExecArray | null;
        let last = 0;
        while ((am = attrRegex.exec(attrs)) !== null) {
          if (am.index > last) tokens.push(<span key={key++} className="text-slate-400">{attrs.slice(last, am.index)}</span>);
          tokens.push(<span key={key++} className="text-sky-300">{am[1]}</span>);
          if (am[2]) {
            tokens.push(<span key={key++} className="text-slate-400">=</span>);
            tokens.push(<span key={key++} className="text-emerald-300">{am[3]}</span>);
          }
          last = am.index + am[0].length;
        }
        if (last < attrs.length) tokens.push(<span key={key++} className="text-slate-400">{attrs.slice(last)}</span>);
      }
      tokens.push(<span key={key++} className="text-slate-500">{close}</span>);
    } else if (m[6]) {
      tokens.push(<span key={key++} className="text-emerald-300">{m[6]}</span>);
    } else if (m[7]) {
      tokens.push(<span key={key++} className="text-slate-300">{m[7]}</span>);
    }
  }
  return <>{tokens}</>;
}

interface ResultsDashboardProps {
  scanData: ScanData;
  onReset: () => void;
}

type ImpactLevel = "critical" | "serious" | "moderate" | "minor";
type Tab = "pages";

const FIX_RECOMMENDATIONS: Record<string, string> = {
  "image-alt":
    "Add an alt attribute describing the image's purpose. Use concise, meaningful text for informative images, or alt=\"\" for purely decorative ones. Avoid phrases like \"image of\" — screen readers already announce that.",
  "image-alt-empty-link":
    "Provide alt text on the linked image, or add accessible text to the link (aria-label, aria-labelledby, title, or visible text). The alt should describe the link's destination, not the image itself.",
  "input-image-alt":
    "Add an alt attribute to the <input type=\"image\"> that describes the button's action (e.g. alt=\"Search\"), not the image's appearance.",
  "html-lang-valid":
    "Add a lang attribute to the <html> element with the page's primary language code (e.g. <html lang=\"en\">). This ensures screen readers use the correct pronunciation engine.",
  "document-title":
    "Add a unique, descriptive <title> element inside <head> that identifies the page's content or function. Titles should be concise and distinct across pages.",
  "label":
    "Associate a <label> with the control using for=\"id\", wrap the control in <label>, or provide aria-label / aria-labelledby / title. The label must describe what input is expected.",
  "label-empty":
    "Add visible text inside the <label> element that describes the associated control, or remove the empty label and provide an accessible name via aria-label or aria-labelledby.",
  "multiple-labels":
    "Keep only one <label> associated with each control. Multiple labels create ambiguous announcements — pick the clearest one and remove the rest.",
  "button-name":
    "Provide accessible text for the button: visible text content, aria-label, aria-labelledby, title, an image with alt, or an SVG with <title> or aria-label.",
  "link-name":
    "Add text that describes the link's destination: visible text, aria-label, aria-labelledby, title, an inner image with alt, or an SVG with <title>/aria-label. Avoid \"click here\".",
  "empty-heading":
    "Add meaningful text to the heading, or remove it if it's not a real section. Empty headings create dead navigation landmarks for screen reader users.",
  "th-empty":
    "Add text to the <th> describing the column or row, or use scope=\"col\"/scope=\"row\" with an abbr attribute. Avoid empty headers — they break table navigation.",
  "aria-reference-broken":
    "Ensure every id referenced by aria-labelledby / aria-describedby exists on the page and is unique. Fix the typo, add the missing element, or remove the invalid attribute.",
  "skip-link-broken":
    "Add a target element (e.g. <main id=\"main-content\">) that matches the skip link's href. The skip link must move focus to real content, not a missing anchor.",
  "duplicate-id":
    "Make each id unique on the page. Duplicate ids break in-page anchors, label associations, and ARIA references. Use classes for styling instead of shared ids.",
};

const impactConfig: Record<ImpactLevel, { icon: typeof AlertOctagon; color: string; bg: string; badge: string; border: string; label: string }> = {
  critical: { icon: AlertOctagon, color: "text-red-400", bg: "bg-red-500/10", badge: "bg-red-500/20 text-red-300 border border-red-500/30", border: "border-l-2 border-l-red-500/60", label: "Critical" },
  serious: { icon: AlertTriangle, color: "text-orange-400", bg: "bg-orange-500/10", badge: "bg-orange-500/20 text-orange-300 border border-orange-500/30", border: "border-l-2 border-l-orange-500/60", label: "Serious" },
  moderate: { icon: AlertCircle, color: "text-amber-400", bg: "bg-amber-500/10", badge: "bg-amber-500/20 text-amber-300 border border-amber-500/30", border: "border-l-2 border-l-amber-500/60", label: "Moderate" },
  minor: { icon: Info, color: "text-blue-400", bg: "bg-blue-500/10", badge: "bg-blue-500/20 text-blue-300 border border-blue-500/30", border: "border-l-2 border-l-blue-500/60", label: "Minor" },
};

export function ResultsDashboard({ scanData, onReset }: ResultsDashboardProps) {
  const [activeTab, setActiveTab] = useState<Tab>("pages");
  const [selectedPage, setSelectedPage] = useState<string | null>(null);
  const [impactFilter, setImpactFilter] = useState<ImpactLevel | "all">("all");
  const [pageFilter, setPageFilter] = useState<"all" | "affected">("all");
  const [expandedViolations, setExpandedViolations] = useState<Set<string>>(new Set());
  const [expandedPage, setExpandedPage] = useState<string | null>(null);
  const [inspectResult, setInspectResult] = useState<ScanResult | null>(null);
  const [inspectPageUrl, setInspectPageUrl] = useState<string | null>(null);
  const [hoverInspect, setHoverInspect] = useState<string | null>(null);


  const { scan, pages, results } = scanData;

  const violationsByImpact = useMemo(() => {
    const counts: Record<ImpactLevel, number> = { critical: 0, serious: 0, moderate: 0, minor: 0 };
    results.forEach((r) => { counts[r.impact as ImpactLevel]++; });
    return counts;
  }, [results]);

  const violationsByCategory = useMemo(() => {
    const cats: Record<string, number> = {};
    results.forEach((r) => { cats[r.category] = (cats[r.category] || 0) + 1; });
    return Object.entries(cats).sort((a, b) => b[1] - a[1]);
  }, [results]);

  const filteredResults = useMemo(() => {
    let filtered = results;
    if (impactFilter !== "all") {
      filtered = filtered.filter((r) => r.impact === impactFilter);
    }
    if (selectedPage) {
      filtered = filtered.filter((r) => r.page_id === selectedPage);
    }
    return filtered;
  }, [results, impactFilter, selectedPage]);

  const toggleViolation = (id: string) => {
    setExpandedViolations((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openInspect = (result: ScanResult, pageUrl: string) => {
    setInspectResult(result);
    setInspectPageUrl(pageUrl);
  };

  const closeInspect = () => { setInspectResult(null); setInspectPageUrl(null); };

  return (
    <>
      {inspectResult && inspectPageUrl && (
        <PreviewModal result={inspectResult} pageUrl={inspectPageUrl} onClose={closeInspect} />
      )}
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Top Bar */}
      <header className="border-b border-slate-800/50 bg-slate-950/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={onReset}
              className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              New Scan
            </button>
            <div className="w-px h-5 bg-slate-800" />
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-emerald-400" />
              <span className="text-sm font-medium">ADA Scanner</span>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Globe className="w-3.5 h-3.5" />
            <span className="max-w-[200px] truncate">{scan.url}</span>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-6 space-y-4">

        {/* ── Hero summary banner ── */}
        {(() => {
          const totalIssues = results.length;
          const totalPages = pages.length;
          const passedPages = pages.filter((p) => p.violation_count === 0 && p.status === "completed").length;
          const failedPages = totalPages - passedPages;
          const hasCritical = violationsByImpact.critical > 0;
          const hasSerious = violationsByImpact.serious > 0;
          const dominantLabel = hasCritical
            ? "Critical Accessibility Issues"
            : hasSerious
            ? "Serious Accessibility Issues"
            : totalIssues > 0
            ? "Accessibility Issues Found"
            : "No Accessibility Issues";
          const dominantColor = hasCritical
            ? "text-red-400"
            : hasSerious
            ? "text-orange-400"
            : totalIssues > 0
            ? "text-amber-400"
            : "text-emerald-400";
          const heroBg = hasCritical
            ? "bg-red-500/10 border-red-500/20"
            : hasSerious
            ? "bg-orange-500/10 border-orange-500/20"
            : totalIssues > 0
            ? "bg-amber-500/10 border-amber-500/20"
            : "bg-emerald-500/10 border-emerald-500/20";
          const IconComp = hasCritical ? AlertOctagon : hasSerious ? AlertTriangle : totalIssues > 0 ? AlertCircle : CheckCircle2;
          const iconColor = hasCritical ? "text-red-400" : hasSerious ? "text-orange-400" : totalIssues > 0 ? "text-amber-400" : "text-emerald-400";
          return (
            <div className={`rounded-xl border p-4 flex items-center justify-between gap-4 ${heroBg}`}>
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center bg-slate-900/60 border border-slate-700/50 shrink-0`}>
                  <IconComp className={`w-6 h-6 ${iconColor}`} />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-white">{dominantLabel}</h2>
                  <p className={`text-sm font-semibold mt-0.5 ${dominantColor}`}>
                    {totalIssues} Need Fixes{" "}
                    <span className="text-slate-400 font-normal text-xs">
                      (across {failedPages} of {totalPages} page{totalPages !== 1 ? "s" : ""})
                    </span>
                  </p>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-semibold text-slate-300 mb-1">Pages</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-extrabold text-emerald-400">{passedPages}</span>
                  <span className="text-base font-semibold text-emerald-400/80">pass</span>
                  <span className="text-slate-600 mx-1 text-lg">/</span>
                  <span className="text-4xl font-extrabold text-red-400">{failedPages}</span>
                  <span className="text-base font-semibold text-red-400/80">fail</span>
                </div>
                <p className="text-xs font-medium text-slate-400 mt-1">of {totalPages} total</p>
              </div>
            </div>
          );
        })()}

        {/* ── 4 severity cards ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {(["critical", "serious", "moderate", "minor"] as ImpactLevel[]).map((level) => {
            const cfg = impactConfig[level];
            const count = violationsByImpact[level];
            const isActive = impactFilter === level;
            return (
              <button
                key={level}
                onClick={() => setImpactFilter((prev) => (prev === level ? "all" : level))}
                className={`rounded-xl border p-4 flex flex-col gap-2 text-left transition-all ${
                  isActive
                    ? `${cfg.bg} border-current ${cfg.color}`
                    : "bg-slate-900/50 border-slate-800 hover:border-slate-700"
                }`}
              >
                <cfg.icon className={`w-5 h-5 ${cfg.color}`} />
                <div>
                  <p className={`text-2xl font-bold ${cfg.color}`}>{count}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{cfg.label}</p>
                </div>
              </button>
            );
          })}
        </div>

        {/* ── Pages list ── */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-0.5">
              <button
                onClick={() => setPageFilter("all")}
                className={`px-3 py-1.5 text-sm font-semibold rounded-md transition-all ${
                  pageFilter === "all"
                    ? "bg-slate-700 text-white shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                All Pages
              </button>
              <button
                onClick={() => setPageFilter("affected")}
                className={`px-3 py-1.5 text-sm font-semibold rounded-md transition-all ${
                  pageFilter === "affected"
                    ? "bg-red-500/20 text-red-300 border border-red-500/30 shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Affected Pages
              </button>
            </div>
            <button
              onClick={() => generateDeveloperReport(scanData)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors shadow-sm"
            >
              <Download className="w-4 h-4" />
              Download Report
            </button>
          </div>
          <div className="space-y-2">
            {pages.filter((page) => pageFilter === "affected" ? page.violation_count > 0 : true).map((page) => {
              const pageViolations = results.filter((r) => r.page_id === page.id);
              const isExpanded = expandedPage === page.id;
              return (
                <div
                  key={page.id}
                  className="bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden"
                >
                  <div className="flex items-start gap-3 p-4">
                    <button
                      onClick={() => setExpandedPage((prev) => (prev === page.id ? null : page.id))}
                      className="flex items-start gap-3 flex-1 min-w-0 text-left"
                    >
                      {page.status === "completed" ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                      ) : (
                        <XCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-200 truncate">
                          {page.title || "Untitled Page"}
                        </p>
                        <p className="text-xs text-slate-500 truncate mt-0.5">{page.url}</p>
                        <div className="flex items-center gap-4 mt-2">
                          <span className="text-xs text-red-400/80">{page.violation_count} violations</span>
                          {page.violation_count === 0 ? (
                            <span className="text-xs text-emerald-400/80">All checks passed</span>
                          ) : page.pass_count > 0 && (
                            <span className="text-xs text-emerald-400/80">{page.pass_count} passes</span>
                          )}
                        </div>
                      </div>
                    </button>
                    <div className="flex items-center gap-2 shrink-0 mt-0.5">
                      {page.violation_count > 0 && (
                        <a
                          href={page.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-violet-500/10 text-violet-300 border border-violet-500/30 hover:bg-violet-500/20 transition-colors"
                          title="Open page"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          Open
                        </a>
                      )}
                      <button
                        onClick={() => setExpandedPage((prev) => (prev === page.id ? null : page.id))}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800 transition-colors"
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                  {isExpanded && pageViolations.length > 0 && (
                    <div className="border-t border-slate-800/50 bg-slate-800/30 p-3 space-y-1.5">
                      {/* Group by rule_id, WAVE-style */}
                      {Object.entries(
                        pageViolations.reduce<Record<string, typeof pageViolations>>((acc, r) => {
                          (acc[r.rule_id] ??= []).push(r);
                          return acc;
                        }, {})
                      ).map(([ruleId, group]) => {
                        const config = impactConfig[group[0].impact as ImpactLevel] ?? impactConfig.moderate;
                        const groupKey = `${page.id}:${ruleId}`;
                        const groupExpanded = expandedViolations.has(groupKey);
                        return (
                          <div key={ruleId} className={`rounded-lg overflow-hidden border border-slate-700/40 ${config.border}`}>
                            {/* Rule row — count + title */}
                            <button
                              onClick={() => toggleViolation(groupKey)}
                              className="w-full px-3 py-2.5 flex items-center gap-2.5 text-left hover:bg-slate-700/30 transition-colors bg-slate-900/70"
                            >
                              <config.icon className={`w-3.5 h-3.5 ${config.color} shrink-0`} />
                              <span className={`text-xs font-bold tabular-nums ${config.color} shrink-0`}>
                                {group.length}
                              </span>
                              <span className="text-xs font-medium text-slate-200 flex-1 min-w-0 truncate">
                                {group[0].title}
                              </span>
                              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${config.badge}`}>
                                {config.label}
                              </span>
                              {groupExpanded ? (
                                <ChevronDown className="w-3 h-3 text-slate-500 shrink-0" />
                              ) : (
                                <ChevronRight className="w-3 h-3 text-slate-500 shrink-0" />
                              )}
                            </button>
                            {/* Individual instances */}
                            {groupExpanded && (
                              <div className="divide-y divide-slate-800/60">
                                {group.map((result, idx) => {
                                  const instanceNum = String(idx + 1).padStart(2, "0");
                                  const impactColor =
                                    result.impact === "critical" ? "border-l-red-500" :
                                    result.impact === "serious"  ? "border-l-orange-500" :
                                    result.impact === "moderate" ? "border-l-amber-500" :
                                                                   "border-l-blue-500";
                                  const numBg =
                                    result.impact === "critical" ? "bg-red-500/20 text-red-300 border-red-500/40" :
                                    result.impact === "serious"  ? "bg-orange-500/20 text-orange-300 border-orange-500/40" :
                                    result.impact === "moderate" ? "bg-amber-500/20 text-amber-300 border-amber-500/40" :
                                                                   "bg-blue-500/20 text-blue-300 border-blue-500/40";
                                  const tagEl = result.element
                                    ? result.element.match(/^<(\w+)/)?.[1]
                                      ? `<${result.element.match(/^<(\w+)/)![1]}>`
                                      : null
                                    : null;

                                  return (
                                    <div
                                      key={result.id}
                                      className={`bg-slate-900/60 border-l-4 ${impactColor} transition-colors hover:bg-slate-800/40`}
                                    >
                                      {/* Instance header row */}
                                      <div className="flex items-start gap-3 px-4 pt-3 pb-2">
                                        <span className={`shrink-0 text-[11px] font-bold font-mono px-2 py-0.5 rounded border ${numBg}`}>
                                          {instanceNum}
                                        </span>
                                        <div className="flex-1 min-w-0">
                                          <p className="text-[12px] font-semibold text-slate-200 leading-snug mb-1">
                                            Instance #{idx + 1}
                                          </p>
                                          <p className="text-[13px] text-slate-300 leading-relaxed">{result.description}</p>
                                        </div>
                                        <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                                          {result.help_url && (
                                            <div className="relative group/fix">
                                              <button
                                                type="button"
                                                className="flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md bg-slate-800 text-slate-400 border border-slate-700 hover:bg-emerald-500/10 hover:text-emerald-300 hover:border-emerald-500/30 transition-colors"
                                              >
                                                <Wrench className="w-3 h-3" />
                                                Fix
                                              </button>
                                              <div className="absolute z-50 bottom-full right-0 mb-2 w-72 p-3 rounded-lg bg-slate-900 border border-slate-700 shadow-xl opacity-0 invisible group-hover/fix:opacity-100 group-hover/fix:visible transition-all duration-150 pointer-events-none">
                                                <div className="flex items-center gap-1.5 mb-1.5">
                                                  <Wrench className="w-3 h-3 text-emerald-400 shrink-0" />
                                                  <span className="text-[11px] font-semibold text-emerald-300">Recommended fix</span>
                                                </div>
                                                <p className="text-[11px] text-slate-300 leading-relaxed">
                                                  {FIX_RECOMMENDATIONS[result.rule_id] || "See the linked reference for guidance on resolving this violation."}
                                                </p>
                                                <p className="mt-2 text-[10px] text-slate-500 leading-relaxed italic">
                                                  {result.description}
                                                </p>
                                                <div className="absolute top-full right-3 -mt-px border-4 border-transparent border-t-slate-700" />
                                              </div>
                                            </div>
                                          )}
                                          <button
                                            onClick={() => openInspect(result, page.url)}
                                            onMouseEnter={() => setHoverInspect(result.id)}
                                            onMouseLeave={() => setHoverInspect(null)}
                                            className={`flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md transition-colors ${
                                              hoverInspect === result.id
                                                ? "bg-red-500/20 text-red-300 border border-red-500/40"
                                                : "bg-slate-800 text-slate-400 border border-slate-700 hover:bg-red-500/10 hover:text-red-300 hover:border-red-500/30"
                                            }`}
                                            title="Inspect this element"
                                          >
                                            <ScanSearch className="w-3 h-3" />
                                            Inspect
                                          </button>
                                        </div>
                                      </div>

                                      {/* Metadata chips row */}
                                      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 px-4 pb-2">
                                        {tagEl && (
                                          <div className="flex items-center gap-1.5">
                                            <span className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wide">HTML Element</span>
                                            <code className="text-[12px] font-mono font-extrabold text-rose-300 bg-rose-500/10 border border-rose-500/30 px-1.5 py-0.5 rounded">
                                              {tagEl}
                                            </code>
                                          </div>
                                        )}
                                        {result.selector && (
                                          <div className="flex items-center gap-1.5">
                                            <span className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wide">Selector</span>
                                            <code className="text-[12px] font-mono font-extrabold text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 px-1.5 py-0.5 rounded max-w-[220px] truncate">
                                              {result.selector}
                                            </code>
                                          </div>
                                        )}
                                      </div>

                                      {/* HTML code block */}
                                      {result.element && (
                                        <div className="px-4 pb-3">
                                          <pre className="text-[11px] bg-slate-950/70 border border-slate-700/60 px-3 py-2.5 rounded-lg overflow-x-auto whitespace-pre-wrap break-all font-mono leading-relaxed">
                                            <HighlightedHtml html={result.element} />
                                          </pre>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {isExpanded && pageViolations.length === 0 && (
                    <div className="border-t border-slate-800/50 bg-slate-800/30 px-4 py-5 flex items-center gap-2 text-emerald-400">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span className="text-xs font-medium">No violations found on this page</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
