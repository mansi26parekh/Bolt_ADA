import { useState } from "react";
import { Shield, Globe, Layers, ArrowRight, CheckCircle2, Search, Zap, BarChart3 } from "lucide-react";

interface LandingPageProps {
  onStartScan: (url: string, maxDepth: number) => void;
  error: string | null;
  initialUrl?: string;
}

export function LandingPage({ onStartScan, error, initialUrl = "" }: LandingPageProps) {
  const [url, setUrl] = useState(initialUrl);
  const [maxDepth, setMaxDepth] = useState(3);
  const [isExpanded, setIsExpanded] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    let finalUrl = url.trim();
    if (!/^https?:\/\//i.test(finalUrl)) {
      finalUrl = "https://" + finalUrl;
    }
    onStartScan(finalUrl, maxDepth);
  };

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
              <div className="bg-slate-900/80 backdrop-blur-sm border border-slate-800 rounded-2xl p-2 shadow-2xl shadow-black/20">
                <div className="flex items-center gap-2">
                  <div className="flex-1 flex items-center gap-3 px-4">
                    <Globe className="w-5 h-5 text-slate-500 shrink-0" />
                    <input
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
