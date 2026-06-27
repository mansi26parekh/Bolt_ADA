import { useEffect, useRef, useState } from "react";
import {
  X,
  Copy,
  Check,
  ExternalLink,
  Code2,
  Lightbulb,
  Terminal,
  AlertOctagon,
  AlertTriangle,
  AlertCircle,
  Info,
} from "lucide-react";
import type { ScanResult } from "../lib/types";

interface InspectPanelProps {
  result: ScanResult | null;
  pageUrl: string | null;
  onClose: () => void;
}

type ImpactLevel = "critical" | "serious" | "moderate" | "minor";

const impactConfig: Record<ImpactLevel, { icon: typeof AlertOctagon; color: string; badge: string; label: string }> = {
  critical: { icon: AlertOctagon, color: "text-red-400", badge: "bg-red-500/20 text-red-300 border border-red-500/30", label: "Critical" },
  serious:  { icon: AlertTriangle, color: "text-orange-400", badge: "bg-orange-500/20 text-orange-300 border border-orange-500/30", label: "Serious" },
  moderate: { icon: AlertCircle, color: "text-amber-400", badge: "bg-amber-500/20 text-amber-300 border border-amber-500/30", label: "Moderate" },
  minor:    { icon: Info, color: "text-blue-400", badge: "bg-blue-500/20 text-blue-300 border border-blue-500/30", label: "Minor" },
};

const FIX_RECOMMENDATIONS: Record<string, { summary: string; code: string }> = {
  "image-alt": {
    summary: "Add a descriptive alt attribute that conveys the image's content or function.",
    code: `<!-- Before -->
<img src="logo.png">

<!-- After -->
<img src="logo.png" alt="Company logo">

<!-- Decorative images (hide from AT) -->
<img src="divider.png" alt="">`,
  },
  "image-alt-empty-link": {
    summary: "A linked image needs alt text so screen readers can describe where the link goes.",
    code: `<!-- Before -->
<a href="/home"><img src="logo.png"></a>

<!-- After: describe the destination -->
<a href="/home"><img src="logo.png" alt="Go to homepage"></a>

<!-- Or use aria-label on the anchor -->
<a href="/home" aria-label="Go to homepage">
  <img src="logo.png" alt="">
</a>`,
  },
  "input-image-alt": {
    summary: "Image buttons must have an alt attribute describing their action.",
    code: `<!-- Before -->
<input type="image" src="submit.png">

<!-- After -->
<input type="image" src="submit.png" alt="Submit form">`,
  },
  "html-lang-valid": {
    summary: "Add a lang attribute to the <html> element so screen readers choose the correct voice.",
    code: `<!-- Before -->
<html>

<!-- After -->
<html lang="en">

<!-- Other examples -->
<html lang="es">  <!-- Spanish -->
<html lang="fr">  <!-- French -->`,
  },
  "document-title": {
    summary: "Every page needs a unique, descriptive <title> in the <head>.",
    code: `<!-- Before -->
<head>
  <!-- no title, or <title></title> -->
</head>

<!-- After -->
<head>
  <title>Products – Acme Store</title>
</head>`,
  },
  "label": {
    summary: "Associate a <label> with every form control using for/id or by wrapping the control.",
    code: `<!-- Option 1: for/id pairing -->
<label for="email">Email address</label>
<input id="email" type="email" name="email">

<!-- Option 2: wrap the control -->
<label>
  Email address
  <input type="email" name="email">
</label>

<!-- Option 3: aria-label (no visible label) -->
<input type="search" aria-label="Search products">`,
  },
  "label-empty": {
    summary: "A <label> element must contain visible text so screen reader users know what the field is.",
    code: `<!-- Before -->
<label for="name"></label>
<input id="name" type="text">

<!-- After -->
<label for="name">Full name</label>
<input id="name" type="text">`,
  },
  "multiple-labels": {
    summary: "Each form control should have exactly one associated label.",
    code: `<!-- Before: two labels for the same input -->
<label for="q">Search</label>
<label for="q">Find</label>
<input id="q" type="text">

<!-- After: one label -->
<label for="q">Search</label>
<input id="q" type="text">`,
  },
  "button-name": {
    summary: "Buttons with no text must get an accessible name via aria-label, aria-labelledby, or visible text.",
    code: `<!-- Before -->
<button><svg>...</svg></button>

<!-- After: aria-label -->
<button aria-label="Close dialog">
  <svg aria-hidden="true">...</svg>
</button>

<!-- After: visually hidden text -->
<button>
  <svg aria-hidden="true">...</svg>
  <span class="sr-only">Close dialog</span>
</button>`,
  },
  "link-name": {
    summary: "Links must have descriptive text so screen reader users understand where they lead.",
    code: `<!-- Before -->
<a href="/report.pdf"></a>

<!-- After: visible text -->
<a href="/report.pdf">Download annual report (PDF)</a>

<!-- After: aria-label for icon links -->
<a href="/settings" aria-label="Account settings">
  <svg aria-hidden="true">...</svg>
</a>`,
  },
  "empty-heading": {
    summary: "Headings must contain text. Remove empty headings or add meaningful content.",
    code: `<!-- Before -->
<h2></h2>

<!-- After: add content -->
<h2>Our Services</h2>

<!-- Or remove it entirely if it was accidental -->`,
  },
  "th-empty": {
    summary: "Table header cells must describe their column or row.",
    code: `<!-- Before -->
<table>
  <tr><th></th><th></th></tr>

<!-- After -->
<table>
  <tr>
    <th scope="col">Product</th>
    <th scope="col">Price</th>
  </tr>`,
  },
  "aria-reference-broken": {
    summary: "The aria-labelledby or aria-describedby value must match an id that exists on the page.",
    code: `<!-- Before: id doesn't exist -->
<input aria-labelledby="missing-label" type="text">

<!-- After: add the referenced element -->
<label id="name-label">Full name</label>
<input aria-labelledby="name-label" type="text">

<!-- Or fix the typo in the id reference -->`,
  },
  "skip-link-broken": {
    summary: "The skip link's href target must exist on the page so keyboard users can bypass navigation.",
    code: `<!-- Before: #main-content doesn't exist -->
<a href="#main-content">Skip to content</a>

<!-- After: add the matching id to your main landmark -->
<a href="#main-content">Skip to content</a>
...
<main id="main-content">
  <!-- page content -->
</main>`,
  },
};

function getFix(ruleId: string) {
  return FIX_RECOMMENDATIONS[ruleId] ?? {
    summary: "Refer to the WCAG reference for remediation guidance.",
    code: `<!-- Review the element below and apply the
     appropriate ARIA or HTML fix -->`,
  };
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <button
      onClick={copy}
      className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 px-2 py-1 rounded transition-colors"
      title={`Copy ${label}`}
    >
      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
      {copied ? "Copied" : label}
    </button>
  );
}

function devtoolsSnippet(selector: string) {
  return `(function(){var el=document.querySelector(${JSON.stringify(selector)});if(!el){console.warn('ADA Scanner: element not found →',${JSON.stringify(selector)});return;}el.style.outline='3px solid #ef4444';el.style.outlineOffset='2px';el.scrollIntoView({behavior:'smooth',block:'center'});setTimeout(function(){el.style.outline='';el.style.outlineOffset='';},4000);})();`;
}

export function InspectPanel({ result, pageUrl, onClose }: InspectPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const visible = result !== null;

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Close on outside click
  useEffect(() => {
    if (!visible) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    setTimeout(() => document.addEventListener("mousedown", handler), 100);
    return () => document.removeEventListener("mousedown", handler);
  }, [visible, onClose]);

  const config = result ? (impactConfig[result.impact as ImpactLevel] ?? impactConfig.moderate) : impactConfig.moderate;
  const fix = result ? getFix(result.rule_id) : null;
  const snippet = result?.selector ? devtoolsSnippet(result.selector) : null;

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/40 backdrop-blur-[2px] z-40 transition-opacity duration-200 ${
          visible ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className={`fixed top-0 right-0 h-full w-full max-w-[480px] bg-slate-950 border-l border-slate-800 z-50 flex flex-col shadow-2xl transition-transform duration-300 ease-out ${
          visible ? "translate-x-0" : "translate-x-full"
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="Inspect issue"
      >
        {result && (
          <>
            {/* Panel header */}
            <div className="flex items-start gap-3 px-5 py-4 border-b border-slate-800 shrink-0">
              <config.icon className={`w-5 h-5 ${config.color} shrink-0 mt-0.5`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white leading-snug">{result.title}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${config.badge}`}>
                    {config.label}
                  </span>
                  <span className="text-[10px] text-slate-500">{result.category}</span>
                </div>
              </div>
              <button
                onClick={onClose}
                className="shrink-0 p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800 transition-colors"
                aria-label="Close inspect panel"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Panel body */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

              {/* Description */}
              <section>
                <h3 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <AlertCircle className="w-3 h-3" />
                  Issue
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">{result.description}</p>
              </section>

              {/* Affected element */}
              {result.element && (
                <section>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                      <Code2 className="w-3 h-3" />
                      Affected HTML
                    </h3>
                    <CopyButton text={result.element} label="HTML" />
                  </div>
                  <div className="relative group">
                    <pre className="text-[11px] text-red-300 bg-red-500/5 border border-red-500/20 px-3 py-3 rounded-lg overflow-x-auto whitespace-pre-wrap break-all font-mono leading-relaxed">
                      {result.element}
                    </pre>
                    {/* Red underline accent */}
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-red-500/40 rounded-b-lg" />
                  </div>
                </section>
              )}

              {/* Selector */}
              {result.selector && (
                <section>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">CSS Selector</h3>
                    <CopyButton text={result.selector} label="Selector" />
                  </div>
                  <code className="text-xs text-emerald-400 bg-emerald-500/5 border border-emerald-500/20 px-3 py-2 rounded-lg block font-mono">
                    {result.selector}
                  </code>
                </section>
              )}

              {/* Recommended fix */}
              {fix && (
                <section>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                      <Lightbulb className="w-3 h-3 text-amber-400" />
                      Recommended Fix
                    </h3>
                    <CopyButton text={fix.code} label="Fix code" />
                  </div>
                  <p className="text-xs text-slate-400 mb-2 leading-relaxed">{fix.summary}</p>
                  <pre className="text-[11px] text-emerald-300 bg-slate-900 border border-slate-700 px-3 py-3 rounded-lg overflow-x-auto whitespace-pre font-mono leading-relaxed">
                    {fix.code}
                  </pre>
                </section>
              )}

              {/* DevTools highlight snippet */}
              {snippet && (
                <section className="bg-slate-900/80 border border-slate-700/60 rounded-xl p-4">
                  <div className="flex items-start gap-2.5">
                    <Terminal className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-slate-200 mb-1">Highlight in browser</p>
                      <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
                        Open the target page in your browser, launch DevTools (F12), paste this into the Console, and the element will scroll into view with a red outline.
                      </p>
                      <pre className="text-[10px] text-slate-400 bg-slate-800 px-2.5 py-2 rounded-lg overflow-x-auto whitespace-pre-wrap break-all font-mono mb-2">
                        {snippet}
                      </pre>
                      <CopyButton text={snippet} label="Copy snippet" />
                    </div>
                  </div>
                </section>
              )}
            </div>

            {/* Panel footer */}
            <div className="px-5 py-3 border-t border-slate-800 shrink-0 flex items-center gap-3">
              {result.help_url && (
                <a
                  href={result.help_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
                >
                  WCAG reference
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
              {pageUrl && (
                <a
                  href={pageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors ml-auto"
                >
                  Open page
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
