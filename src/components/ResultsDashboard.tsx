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
  FileCode,
} from "lucide-react";
import type { ScanData, ScanResult } from "../lib/types";
import { PreviewModal } from "./InspectPanel";
import { generateDeveloperReport } from "../lib/pdfExport";

interface ResultsDashboardProps {
  scanData: ScanData;
  onReset: () => void;
}

type ImpactLevel = "critical" | "serious" | "moderate" | "minor";
type Tab = "pages";

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
  const [expandedViolations, setExpandedViolations] = useState<Set<string>>(new Set());
  const [expandedPage, setExpandedPage] = useState<string | null>(null);
  const [inspectResult, setInspectResult] = useState<ScanResult | null>(null);
  const [inspectPageUrl, setInspectPageUrl] = useState<string | null>(null);
  const [hoverInspect, setHoverInspect] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

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

  const scoreColor = (score: number | null) => {
    if (score === null) return "text-slate-500";
    if (score >= 80) return "text-emerald-400";
    if (score >= 50) return "text-amber-400";
    return "text-red-400";
  };

  const scoreBg = (score: number | null) => {
    if (score === null) return "bg-slate-800";
    if (score >= 80) return "bg-emerald-500/10 border-emerald-500/20";
    if (score >= 50) return "bg-amber-500/10 border-amber-500/20";
    return "bg-red-500/10 border-red-500/20";
  };

  const scoreLabel = (score: number | null) => {
    if (score === null) return "N/A";
    if (score >= 90) return "Excellent";
    if (score >= 80) return "Good";
    if (score >= 60) return "Needs Work";
    if (score >= 40) return "Poor";
    return "Critical";
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

      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Pages Tab */}
        <div className="space-y-4">
          <div className="flex items-center justify-end">
            <div className="relative">
              <button
                onClick={() => setExportOpen((p) => !p)}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors shadow-sm"
              >
                <Download className="w-4 h-4" />
                Export Report
                <ChevronDown className={`w-4 h-4 transition-transform ${exportOpen ? "rotate-180" : ""}`} />
              </button>
              {exportOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setExportOpen(false)} />
                  <div className="absolute right-0 mt-2 w-56 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-50 overflow-hidden">
                    <button
                      onClick={() => { setExportOpen(false); generateDeveloperReport(scanData); }}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm text-slate-200 hover:bg-slate-700/80 transition-colors"
                    >
                      <FileCode className="w-4 h-4 text-blue-400 shrink-0" />
                      <div>
                        <div className="font-medium">Developer Report</div>
                        <div className="text-xs text-slate-500">Technical details with inspect links</div>
                      </div>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="space-y-2">
            {pages.map((page) => {
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
                              <div className="divide-y divide-slate-800/50">
                                {group.map((result, idx) => (
                                  <div
                                    key={result.id}
                                    className={`px-3 py-2 pl-9 bg-slate-900/70 space-y-1.5 transition-colors ${
                                      hoverInspect === result.id ? "bg-red-500/5" : ""
                                    }`}
                                  >
                                    <div className="flex items-center justify-between">
                                      <p className="text-[10px] text-slate-500 font-medium">Instance {idx + 1}</p>
                                      <button
                                        onClick={() => openInspect(result, page.url)}
                                        onMouseEnter={() => setHoverInspect(result.id)}
                                        onMouseLeave={() => setHoverInspect(null)}
                                        className={`flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-md transition-colors ${
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
                                    <p className="text-[11px] text-slate-400 leading-relaxed">{result.description}</p>
                                    {result.element && (
                                      <code className="text-[10px] text-slate-400 bg-slate-800/60 px-2 py-1 rounded block break-all font-mono">
                                        {result.element}
                                      </code>
                                    )}
                                    {result.selector && (
                                      <p className="text-[10px] text-slate-500 font-mono">{result.selector}</p>
                                    )}
                                  </div>
                                ))}
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
