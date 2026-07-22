import { useState, useRef, useEffect } from "react";
import {
  Shield,
  Globe,
  Layers,
  ArrowRight,
  CheckCircle2,
  Search,
  Zap,
  BarChart3,
  History,
  ChevronRight,
} from "lucide-react";
import type { Project } from "../lib/types";

interface LandingPageProps {
  onStartScan: (url: string, maxDepth: number) => void;
  error: string | null;
  initialUrl?: string;
  projects?: Project[];
  onSelectProject?: (project: Project) => void;
}

export function LandingPage({
  onStartScan,
  error,
  initialUrl = "",
  projects = [],
  onSelectProject,
}: LandingPageProps) {
  const [url, setUrl] = useState(initialUrl);
  const [maxDepth, setMaxDepth] = useState(3);
  const [isExpanded, setIsExpanded] = useState(false);
  const [retestChoice, setRetestChoice] = useState<"yes" | "no" | "">("");
  const [showAllProjects, setShowAllProjects] = useState(false);

  const urlInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialUrl) setUrl(initialUrl);
  }, [initialUrl]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    let finalUrl = url.trim();
    if (!/^https?:\/\//i.test(finalUrl)) {
      finalUrl = "https://" + finalUrl;
    }
    onStartScan(finalUrl, maxDepth);
  };

  const handleRetestChange = (choice: "yes" | "no") => {
    setRetestChoice(choice);
    if (choice === "no") {
      setShowAllProjects(false);
      setTimeout(() => urlInputRef.current?.focus(), 50);
    }
  };

  const recentProjects = [...projects]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5);

  const displayedProjects = showAllProjects
    ? [...projects].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    : recentProjects;

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Hero Section */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-950/40 via-slate-950 to-teal-950/30" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-emerald-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-teal-500/5 rounded-full blur-3xl" />

        <div className="relative max-w-5xl mx-auto px-6 pt-20 pb-16">
          {/* Nav */}
          <nav className="flex items-center justify-between mb-20">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 bg-emerald-500 rounded-lg flex items-center justify-center">
                <Shield className="w-5 h-5 text-white" />
              </div>
              <span className="text-lg font-semibold tracking-tight">ADA Scanner</span>
            </div>
            <div className="flex items-center gap-6 text-sm text-slate-400">
              <a href="#features" className="hover:text-white transition-colors">Features</a>
              <a href="#how-it-works" className="hover:text-white transition-colors">How It Works</a>
            </div>
          </nav>

          {/* Hero Content */}
          <div className="text-center max-w-3xl mx-auto mb-14">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full text-emerald-400 text-xs font-medium mb-6">
              <Zap className="w-3.5 h-3.5" />
              Multi-page site scanning
            </div>
            <h1 className="text-5xl sm:text-6xl font-bold tracking-tight leading-[1.1] mb-5">
              Find accessibility<br />
              <span className="bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
                issues before your users do
              </span>
            </h1>
            <p className="text-lg text-slate-400 leading-relaxed max-w-xl mx-auto">
              Scan your entire website for ADA and WCAG compliance violations.
              Crawl multiple pages, get detailed reports, and fix issues that matter.
            </p>
          </div>

          {/* Scan Form */}
          <div className="max-w-2xl mx-auto">
            <form onSubmit={handleSubmit} className="relative">
              <div
                className={`bg-slate-900/80 backdrop-blur-sm border rounded-2xl p-2 shadow-2xl shadow-black/20 transition-all duration-300 ${
                  retestChoice === "no" ? "border-emerald-500/60 ring-2 ring-emerald-500/20" : "border-slate-800"
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className="flex-1 flex items-center gap-3 px-4">
                    <Globe className="w-5 h-5 text-slate-500 shrink-0" />
                    <input
                      ref={urlInputRef}
                      type="text"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="Enter your website URL..."
                      className="flex-1 bg-transparent text-white placeholder-slate-500 py-3.5 text-base outline-none"
                      autoFocus
                    />
                  </div>
                  <button
                    type="submit"
                    className="shrink-0 bg-emerald-500 hover:bg-emerald-400 text-white font-semibold px-6 py-3 rounded-xl transition-all duration-200 flex items-center gap-2 shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30"
                  >
                    Scan Site
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {error && (
                <div className="mt-3 px-4 py-2.5 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
                  {error}
                </div>
              )}
            </form>

            {/* Re-test Radio */}
            <div className="mt-4 flex items-center justify-center gap-6">
              <span className="text-sm text-slate-400">Do you want to re-test?</span>
              <label className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="radio"
                  name="retest"
                  value="yes"
                  checked={retestChoice === "yes"}
                  onChange={() => handleRetestChange("yes")}
                  className="w-4 h-4 accent-emerald-500 cursor-pointer"
                />
                <span className={`text-sm transition-colors ${retestChoice === "yes" ? "text-emerald-400 font-medium" : "text-slate-400 group-hover:text-slate-200"}`}>
                  Yes
                </span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="radio"
                  name="retest"
                  value="no"
                  checked={retestChoice === "no"}
                  onChange={() => handleRetestChange("no")}
                  className="w-4 h-4 accent-emerald-500 cursor-pointer"
                />
                <span className={`text-sm transition-colors ${retestChoice === "no" ? "text-emerald-400 font-medium" : "text-slate-400 group-hover:text-slate-200"}`}>
                  No
                </span>
              </label>
            </div>

            {/* Recent Projects Card (shown when "Yes" is selected) */}
            {retestChoice === "yes" && recentProjects.length > 0 && (
              <div className="mt-5 bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-300">
                <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-800">
                  <History className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-sm font-semibold text-white">
                    {showAllProjects ? "All Scanned Projects" : "Recent Scanned Projects"}
                  </h3>
                  <span className="text-xs text-slate-500 ml-auto">{displayedProjects.length} project{displayedProjects.length !== 1 ? "s" : ""}</span>
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {displayedProjects.map((project) => (
                    <button
                      key={project.id}
                      onClick={() => onSelectProject?.(project)}
                      className="w-full flex items-center gap-3 px-5 py-3 hover:bg-slate-800/50 transition-colors text-left group border-b border-slate-800/50 last:border-b-0"
                    >
                      <div className="w-8 h-8 bg-slate-800 rounded-lg flex items-center justify-center shrink-0 group-hover:bg-emerald-500/10 transition-colors">
                        <Globe className="w-4 h-4 text-slate-400 group-hover:text-emerald-400 transition-colors" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{project.name}</p>
                        <p className="text-xs text-slate-500 truncate">{project.url}</p>
                      </div>
                      {project.last_scan_id && (
                        <span className="text-xs text-emerald-400/70 shrink-0">Scanned</span>
                      )}
                      <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-slate-400 transition-colors shrink-0" />
                    </button>
                  ))}
                </div>
                {!showAllProjects && projects.length > 5 && (
                  <button
                    onClick={() => setShowAllProjects(true)}
                    className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-slate-800/30 hover:bg-slate-800/60 text-emerald-400 text-sm font-medium transition-colors border-t border-slate-800"
                  >
                    View All
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
                {showAllProjects && (
                  <button
                    onClick={() => setShowAllProjects(false)}
                    className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-slate-800/30 hover:bg-slate-800/60 text-slate-400 text-sm font-medium transition-colors border-t border-slate-800"
                  >
                    Show Less
                  </button>
                )}
              </div>
            )}

            {retestChoice === "yes" && recentProjects.length === 0 && (
              <div className="mt-5 bg-slate-900/60 border border-slate-800 rounded-xl px-5 py-8 text-center animate-in fade-in duration-200">
                <History className="w-6 h-6 text-slate-600 mx-auto mb-2" />
                <p className="text-sm text-slate-500">No previous scans yet. Enter a URL above to start your first scan.</p>
              </div>
            )}

            {/* Advanced Options Toggle */}
            <div className="mt-4 text-center">
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="text-sm text-slate-500 hover:text-slate-300 transition-colors inline-flex items-center gap-1.5"
              >
                <Layers className="w-3.5 h-3.5" />
                {isExpanded ? "Hide" : "Show"} advanced options
              </button>
            </div>

            {/* Advanced Options Panel */}
            {isExpanded && (
              <div className="mt-4 bg-slate-900/60 border border-slate-800 rounded-xl p-5 animate-in fade-in duration-200">
                <label className="block text-xs font-medium text-slate-400 mb-2">Crawl Depth</label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={1}
                    max={5}
                    value={maxDepth}
                    onChange={(e) => setMaxDepth(parseInt(e.target.value))}
                    className="flex-1 accent-emerald-500"
                  />
                  <span className="text-sm font-mono text-emerald-400 w-6 text-right">{maxDepth}</span>
                </div>
                <p className="text-xs text-slate-600 mt-1">How deep to follow links from the start page</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Features Section */}
      <section id="features" className="max-w-5xl mx-auto px-6 py-20">
        <div className="text-center mb-14">
          <h2 className="text-3xl font-bold tracking-tight mb-3">Comprehensive scanning</h2>
          <p className="text-slate-400">Go beyond single-page checks. Scan your entire site.</p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {[
            {
              icon: Search,
              title: "Multi-Page Crawling",
              description: "Automatically discovers and scans linked pages within your site, not just the URL you enter.",
            },
            {
              icon: BarChart3,
              title: "Detailed Reports",
              description: "Get per-page scores, categorized violations by WCAG criteria, and specific element selectors.",
            },
            {
              icon: Shield,
              title: "WCAG 2.1 Coverage",
              description: "Checks for 15+ accessibility rules covering images, forms, headings, ARIA, and more.",
            },
          ].map((feature) => (
            <div
              key={feature.title}
              className="bg-slate-900/50 border border-slate-800 rounded-xl p-6 hover:border-slate-700 transition-colors group"
            >
              <div className="w-10 h-10 bg-emerald-500/10 rounded-lg flex items-center justify-center mb-4 group-hover:bg-emerald-500/15 transition-colors">
                <feature.icon className="w-5 h-5 text-emerald-400" />
              </div>
              <h3 className="font-semibold text-white mb-2">{feature.title}</h3>
              <p className="text-sm text-slate-400 leading-relaxed">{feature.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="max-w-5xl mx-auto px-6 py-20 border-t border-slate-800/50">
        <div className="text-center mb-14">
          <h2 className="text-3xl font-bold tracking-tight mb-3">How it works</h2>
          <p className="text-slate-400">Three steps to an accessible website.</p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          {[
            { step: "1", title: "Enter your URL", description: "Paste your website address and configure crawl depth and page limits." },
            { step: "2", title: "We scan your site", description: "Our crawler discovers pages and runs accessibility checks on each one." },
            { step: "3", title: "Review and fix", description: "Get a detailed report with violations categorized by impact and WCAG criteria." },
          ].map((item) => (
            <div key={item.step} className="text-center">
              <div className="w-12 h-12 bg-emerald-500/10 border border-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-emerald-400 font-bold">{item.step}</span>
              </div>
              <h3 className="font-semibold text-white mb-2">{item.title}</h3>
              <p className="text-sm text-slate-400 leading-relaxed">{item.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Checks List */}
      <section className="max-w-5xl mx-auto px-6 py-20 border-t border-slate-800/50">
        <div className="text-center mb-10">
          <h2 className="text-3xl font-bold tracking-tight mb-3">What we check</h2>
          <p className="text-slate-400">Covering the most impactful WCAG success criteria.</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 max-w-3xl mx-auto">
          {[
            "Image alt text",
            "Document language",
            "Page titles",
            "Link text",
            "Form labels",
            "Heading hierarchy",
            "Color contrast",
            "Skip navigation",
            "Button labels",
            "Iframe titles",
            "Main landmarks",
            "Table headers",
            "ARIA validity",
            "Autoplay media",
            "Focus management",
          ].map((check) => (
            <div key={check} className="flex items-center gap-2.5 text-sm text-slate-300">
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
              {check}
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800/50 py-8">
        <div className="max-w-5xl mx-auto px-6 flex items-center justify-between text-xs text-slate-600">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4" />
            ADA Scanner
          </div>
          <span>Built for a more accessible web</span>
        </div>
      </footer>
    </div>
  );
}
