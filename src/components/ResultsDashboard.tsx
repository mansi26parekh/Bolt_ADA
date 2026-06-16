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
} from "lucide-react";
import type { ScanData } from "../lib/types";

interface ResultsDashboardProps {
  scanData: ScanData;
  onReset: () => void;
}

type ImpactLevel = "critical" | "serious" | "moderate" | "minor";
type Tab = "overview" | "pages" | "violations";

const impactConfig: Record<ImpactLevel, { icon: typeof AlertOctagon; color: string; bg: string; badge: string; border: string; label: string }> = {
  critical: { icon: AlertOctagon, color: "text-red-400", bg: "bg-red-500/10", badge: "bg-red-500/20 text-red-300 border border-red-500/30", border: "border-l-2 border-l-red-500/60", label: "Critical" },
  serious: { icon: AlertTriangle, color: "text-orange-400", bg: "bg-orange-500/10", badge: "bg-orange-500/20 text-orange-300 border border-orange-500/30", border: "border-l-2 border-l-orange-500/60", label: "Serious" },
  moderate: { icon: AlertCircle, color: "text-amber-400", bg: "bg-amber-500/10", badge: "bg-amber-500/20 text-amber-300 border border-amber-500/30", border: "border-l-2 border-l-amber-500/60", label: "Moderate" },
  minor: { icon: Info, color: "text-blue-400", bg: "bg-blue-500/10", badge: "bg-blue-500/20 text-blue-300 border border-blue-500/30", border: "border-l-2 border-l-blue-500/60", label: "Minor" },
};

export function ResultsDashboard({ scanData, onReset }: ResultsDashboardProps) {
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [selectedPage, setSelectedPage] = useState<string | null>(null);
  const [impactFilter, setImpactFilter] = useState<ImpactLevel | "all">("all");
  const [expandedViolations, setExpandedViolations] = useState<Set<string>>(new Set());
  const [expandedPage, setExpandedPage] = useState<string | null>(null);

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

  return (
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
        {/* Score Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6 mb-8">
          <div className={`w-24 h-24 rounded-2xl border flex flex-col items-center justify-center ${scoreBg(scan.score)}`}>
            <span className={`text-3xl font-bold ${scoreColor(scan.score)}`}>
              {scan.score ?? "--"}
            </span>
            <span className="text-[10px] text-slate-500 uppercase tracking-wider mt-0.5">Score</span>
          </div>
          <div className="flex-1">
            <h1 className="text-xl font-bold mb-1">
              {scoreLabel(scan.score)} Accessibility
            </h1>
            <p className="text-sm text-slate-400 mb-3">
              {scan.total_violations} violations found across {scan.pages_scanned} pages
            </p>
            <div className="flex items-center gap-4">
              {(["critical", "serious", "moderate", "minor"] as ImpactLevel[]).map((impact) => {
                const config = impactConfig[impact];
                const count = violationsByImpact[impact];
                if (count === 0) return null;
                return (
                  <div key={impact} className="flex items-center gap-1.5">
                    <config.icon className={`w-3.5 h-3.5 ${config.color}`} />
                    <span className="text-xs text-slate-400">{count} {config.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Impact Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          {(["critical", "serious", "moderate", "minor"] as ImpactLevel[]).map((impact) => {
            const config = impactConfig[impact];
            const count = violationsByImpact[impact];
            return (
              <button
                key={impact}
                onClick={() => {
                  setImpactFilter(impactFilter === impact ? "all" : impact);
                  setActiveTab("violations");
                }}
                className={`p-4 rounded-xl border transition-all ${
                  impactFilter === impact
                    ? `${config.bg} border-current ${config.color}`
                    : "bg-slate-900/50 border-slate-800 hover:border-slate-700"
                }`}
              >
                <config.icon className={`w-5 h-5 mb-2 ${config.color}`} />
                <p className="text-2xl font-bold">{count}</p>
                <p className="text-xs text-slate-500 mt-0.5">{config.label}</p>
              </button>
            );
          })}
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-slate-800 mb-6">
          {([
            { id: "overview" as Tab, label: "Overview", icon: BarChart3 },
            { id: "pages" as Tab, label: "Pages", icon: FileText },
            { id: "violations" as Tab, label: "Violations", icon: AlertTriangle },
          ]).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors -mb-px ${
                activeTab === tab.id
                  ? "border-emerald-400 text-emerald-400"
                  : "border-transparent text-slate-500 hover:text-slate-300"
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
              {tab.id === "violations" && (
                <span className="text-xs bg-slate-800 px-1.5 py-0.5 rounded-full">{results.length}</span>
              )}
            </button>
          ))}
        </div>

        {/* Overview Tab */}
        {activeTab === "overview" && (
          <div className="grid md:grid-cols-2 gap-6">
            {/* Violations by Category */}
            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5">
              <h3 className="text-sm font-semibold mb-4">Violations by WCAG Category</h3>
              <div className="space-y-3">
                {violationsByCategory.map(([category, count]) => (
                  <div key={category} className="flex items-center gap-3">
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-slate-300">{category}</span>
                        <span className="text-xs text-slate-500">{count}</span>
                      </div>
                      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-500/60 rounded-full"
                          style={{ width: `${(count / results.length) * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Page Scores */}
            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5">
              <h3 className="text-sm font-semibold mb-4">Page Scores</h3>
              <div className="space-y-2">
                {pages
                  .filter((p) => p.status === "completed")
                  .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))
                  .map((page) => (
                    <button
                      key={page.id}
                      onClick={() => {
                        setSelectedPage(page.id);
                        setActiveTab("violations");
                      }}
                      className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-slate-800/50 transition-colors text-left"
                    >
                      <span className={`text-sm font-mono font-bold w-8 text-right ${scoreColor(page.score)}`}>
                        {page.score ?? "--"}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-300 truncate">{page.title || page.url}</p>
                      </div>
                      <span className="text-xs text-slate-600">{page.violation_count} issues</span>
                    </button>
                  ))}
              </div>
            </div>
          </div>
        )}

        {/* Pages Tab */}
        {activeTab === "pages" && (
          <div className="space-y-2">
            {pages.map((page) => {
              const pageViolations = results.filter((r) => r.page_id === page.id);
              const isExpanded = expandedPage === page.id;
              return (
                <div
                  key={page.id}
                  className="bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden"
                >
                  <button
                    onClick={() => setExpandedPage((prev) => (prev === page.id ? null : page.id))}
                    className="w-full p-4 flex items-start gap-3 text-left hover:bg-slate-800/30 transition-colors"
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
                        <span className={`text-xs font-mono font-medium px-2 py-0.5 rounded-md ${scoreBg(page.score)} ${scoreColor(page.score)}`}>
                          Score: {page.score ?? "N/A"}
                        </span>
                        <span className="text-xs text-slate-500">
                          Depth: {page.depth}
                        </span>
                        <span className="text-xs text-red-400/80">
                          {page.violation_count} violations
                        </span>
                        {page.violation_count === 0 ? (
                          <span className="text-xs text-emerald-400/80">
                            All checks passed
                          </span>
                        ) : page.pass_count > 0 && (
                          <span className="text-xs text-emerald-400/80">
                            {page.pass_count} passes
                          </span>
                        )}
                      </div>
                    </div>
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4 text-slate-600 shrink-0 mt-1" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-slate-600 shrink-0 mt-1" />
                    )}
                  </button>
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
                                  <div key={result.id} className="px-3 py-2 pl-9 bg-slate-900/70 space-y-1.5">
                                    <p className="text-[10px] text-slate-500 font-medium">Instance {idx + 1}</p>
                                    <p className="text-[11px] text-slate-400 leading-relaxed">{result.description}</p>
                                    {result.element && (
                                      <code className="text-[10px] text-slate-400 bg-slate-800/60 px-2 py-1 rounded block break-all font-mono">
                                        {result.element}
                                      </code>
                                    )}
                                    {result.selector && (
                                      <p className="text-[10px] text-slate-500 font-mono">{result.selector}</p>
                                    )}
                                    {result.help_url && (
                                      <a
                                        href={result.help_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 text-[10px] text-emerald-400 hover:text-emerald-300 transition-colors"
                                      >
                                        Learn how to fix
                                        <ExternalLink className="w-2.5 h-2.5" />
                                      </a>
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
        )}

        {/* Violations Tab */}
        {activeTab === "violations" && (
          <div>
            {/* Filters */}
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              {selectedPage && (
                <button
                  onClick={() => setSelectedPage(null)}
                  className="flex items-center gap-1.5 text-xs bg-emerald-500/10 text-emerald-400 px-3 py-1.5 rounded-lg border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
                >
                  {pages.find((p) => p.id === selectedPage)?.title || "Page"}
                  <XCircle className="w-3 h-3" />
                </button>
              )}
              {impactFilter !== "all" && (
                <button
                  onClick={() => setImpactFilter("all")}
                  className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                    impactConfig[impactFilter].bg
                  } ${impactConfig[impactFilter].color} border-current`}
                >
                  {impactConfig[impactFilter].label}
                  <XCircle className="w-3 h-3" />
                </button>
              )}
              <span className="text-xs text-slate-500 ml-auto">
                {filteredResults.length} result{filteredResults.length !== 1 ? "s" : ""}
              </span>
            </div>

            {/* Violation List */}
            <div className="space-y-2">
              {filteredResults.length === 0 && (
                <div className="text-center py-12">
                  <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-3" />
                  <p className="text-sm text-slate-400">No violations match your filters</p>
                </div>
              )}
              {filteredResults.map((result) => {
                const config = impactConfig[result.impact as ImpactLevel] ?? impactConfig.moderate;
                const isExpanded = expandedViolations.has(result.id);
                return (
                  <div
                    key={result.id}
                    className="bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden"
                  >
                    <button
                      onClick={() => toggleViolation(result.id)}
                      className="w-full p-4 flex items-start gap-3 text-left hover:bg-slate-800/30 transition-colors"
                    >
                      <config.icon className={`w-4 h-4 ${config.color} shrink-0 mt-0.5`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-200">{result.title}</p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${config.badge}`}>
                            {config.label}
                          </span>
                          <span className="text-[10px] text-slate-600">{result.category}</span>
                        </div>
                      </div>
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-slate-600 shrink-0" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-slate-600 shrink-0" />
                      )}
                    </button>
                    {isExpanded && (
                      <div className="px-4 pb-4 pl-11 space-y-3">
                        <div>
                          <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Description</p>
                          <p className="text-xs text-slate-300">{result.description}</p>
                        </div>
                        {result.element && (
                          <div>
                            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Element</p>
                            <code className="text-xs text-slate-300 bg-slate-800/50 px-3 py-1.5 rounded-lg block break-all">
                              {result.element}
                            </code>
                          </div>
                        )}
                        {result.selector && (
                          <div>
                            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Selector</p>
                            <code className="text-xs text-emerald-400/80 bg-slate-800/50 px-3 py-1.5 rounded-lg block">
                              {result.selector}
                            </code>
                          </div>
                        )}
                        {result.help_url && (
                          <a
                            href={result.help_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
                          >
                            Learn how to fix this
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
