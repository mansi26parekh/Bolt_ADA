import { useEffect, useRef, useState, useCallback } from "react";
import {
  X,
  Copy,
  Check,
  ExternalLink,
  Code2,
  Lightbulb,
  AlertOctagon,
  AlertTriangle,
  AlertCircle,
  Info,
  ScanSearch,
  Loader2,
  AlertCircle as AlertCircleIcon,
  Monitor,
} from "lucide-react";
import type { ScanResult } from "../lib/types";

const PROXY_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fetch-page`;

interface InspectPanelProps {
  result: ScanResult | null;
  pageUrl: string | null;
  onClose: () => void;
}

type ImpactLevel = "critical" | "serious" | "moderate" | "minor";

const impactConfig: Record<ImpactLevel, { icon: typeof AlertOctagon; color: string; badge: string; label: string }> = {
  critical: { icon: AlertOctagon,  color: "text-red-400",    badge: "bg-red-500/20 text-red-300 border border-red-500/30",    label: "Critical" },
  serious:  { icon: AlertTriangle, color: "text-orange-400", badge: "bg-orange-500/20 text-orange-300 border border-orange-500/30", label: "Serious" },
  moderate: { icon: AlertCircle,   color: "text-amber-400",  badge: "bg-amber-500/20 text-amber-300 border border-amber-500/30",  label: "Moderate" },
  minor:    { icon: Info,          color: "text-blue-400",   badge: "bg-blue-500/20 text-blue-300 border border-blue-500/30",   label: "Minor" },
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

<!-- After -->
<a href="/home"><img src="logo.png" alt="Go to homepage"></a>`,
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
<html lang="en">`,
  },
  "document-title": {
    summary: "Every page needs a unique, descriptive <title> in the <head>.",
    code: `<!-- Before -->
<head><!-- no title --></head>

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

<!-- Option 2: aria-label -->
<input type="search" aria-label="Search products">`,
  },
  "label-empty": {
    summary: "A <label> element must contain visible text.",
    code: `<!-- Before -->
<label for="name"></label>
<input id="name" type="text">

<!-- After -->
<label for="name">Full name</label>
<input id="name" type="text">`,
  },
  "button-name": {
    summary: "Buttons with no text must get an accessible name via aria-label or visible text.",
    code: `<!-- Before -->
<button><svg>...</svg></button>

<!-- After -->
<button aria-label="Close dialog">
  <svg aria-hidden="true">...</svg>
</button>`,
  },
  "link-name": {
    summary: "Links must have descriptive text so screen reader users understand where they lead.",
    code: `<!-- Before -->
<a href="/report.pdf"></a>

<!-- After -->
<a href="/report.pdf">Download annual report (PDF)</a>`,
  },
  "empty-heading": {
    summary: "Headings must contain text. Remove empty headings or add meaningful content.",
    code: `<!-- Before -->
<h2></h2>

<!-- After -->
<h2>Our Services</h2>`,
  },
  "aria-reference-broken": {
    summary: "The aria-labelledby or aria-describedby value must match an id that exists on the page.",
    code: `<!-- Before: id doesn't exist -->
<input aria-labelledby="missing-label" type="text">

<!-- After: add the referenced element -->
<label id="name-label">Full name</label>
<input aria-labelledby="name-label" type="text">`,
  },
  "skip-link-broken": {
    summary: "The skip link's href target must exist on the page so keyboard users can bypass navigation.",
    code: `<!-- After: add matching id to main landmark -->
<a href="#main-content">Skip to content</a>
...
<main id="main-content"><!-- content --></main>`,
  },
};

function getFix(ruleId: string) {
  return FIX_RECOMMENDATIONS[ruleId] ?? {
    summary: "Refer to the WCAG reference for remediation guidance.",
    code: `<!-- Review the element and apply the
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
    >
      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
      {copied ? "Copied" : label}
    </button>
  );
}

// ── Live Preview Modal ────────────────────────────────────────────────────────

type PreviewStatus = "loading" | "ready" | "not-found" | "error";

interface PreviewModalProps {
  pageUrl: string;
  selector: string | null | undefined;
  onClose: () => void;
}

function PreviewModal({ pageUrl, selector, onClose }: PreviewModalProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<PreviewStatus>("loading");

  const proxyUrl = `${PROXY_BASE}?url=${encodeURIComponent(pageUrl)}`;

  const sendHighlight = useCallback(() => {
    if (!selector || !iframeRef.current?.contentWindow) return;
    iframeRef.current.contentWindow.postMessage(
      { type: "ada-highlight", selector },
      "*"
    );
  }, [selector]);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "ada-ready") {
        setStatus("loading"); // briefly stay loading while we send the message
        sendHighlight();
      }
      if (e.data?.type === "ada-found") setStatus("ready");
      if (e.data?.type === "ada-not-found") setStatus("not-found");
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [sendHighlight]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-slate-950">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 h-12 border-b border-slate-800 shrink-0 bg-slate-950">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-xs font-semibold text-white">Live Inspect</span>
        </div>

        <div className="flex items-center gap-1.5 flex-1 min-w-0 mx-3 bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5">
          <Monitor className="w-3 h-3 text-slate-500 shrink-0" />
          <span className="text-xs text-slate-400 truncate">{pageUrl}</span>
        </div>

        {status === "loading" && (
          <span className="flex items-center gap-1.5 text-[11px] text-slate-400 shrink-0">
            <Loader2 className="w-3 h-3 animate-spin" />
            Locating element…
          </span>
        )}
        {status === "ready" && (
          <span className="flex items-center gap-1.5 text-[11px] text-emerald-400 shrink-0">
            <Check className="w-3 h-3" />
            Element highlighted
          </span>
        )}
        {status === "not-found" && (
          <span className="flex items-center gap-1.5 text-[11px] text-amber-400 shrink-0">
            <AlertCircleIcon className="w-3 h-3" />
            Element not found
          </span>
        )}

        <button
          onClick={onClose}
          className="shrink-0 p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800 transition-colors ml-1"
          aria-label="Close preview"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Iframe */}
      <iframe
        ref={iframeRef}
        src={proxyUrl}
        className="flex-1 w-full border-0 bg-white"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        title="Live page preview"
        onError={() => setStatus("error")}
      />
    </div>
  );
}

// ── Main InspectPanel ─────────────────────────────────────────────────────────

export function InspectPanel({ result, pageUrl, onClose }: InspectPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [showPreview, setShowPreview] = useState(false);
  const visible = result !== null;

  // Reset preview when result changes
  useEffect(() => { setShowPreview(false); }, [result]);

  // Close panel on Escape (unless preview is open — preview handles its own Escape)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !showPreview) onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose, showPreview]);

  // Close panel on backdrop click
  useEffect(() => {
    if (!visible || showPreview) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    setTimeout(() => document.addEventListener("mousedown", handler), 100);
    return () => document.removeEventListener("mousedown", handler);
  }, [visible, onClose, showPreview]);

  const config = result ? (impactConfig[result.impact as ImpactLevel] ?? impactConfig.moderate) : impactConfig.moderate;
  const fix = result ? getFix(result.rule_id) : null;

  return (
    <>
      {/* Live preview modal */}
      {showPreview && result && pageUrl && (
        <PreviewModal
          pageUrl={pageUrl}
          selector={result.selector}
          onClose={() => setShowPreview(false)}
        />
      )}

      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/40 backdrop-blur-[2px] z-40 transition-opacity duration-200 ${
          visible && !showPreview ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        aria-hidden="true"
      />

      {/* Side panel */}
      <div
        ref={panelRef}
        className={`fixed top-0 right-0 h-full w-full max-w-[480px] bg-slate-950 border-l border-slate-800 z-50 flex flex-col shadow-2xl transition-transform duration-300 ease-out ${
          visible && !showPreview ? "translate-x-0" : "translate-x-full"
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="Inspect issue"
      >
        {result && (
          <>
            {/* Header */}
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

            {/* Live Inspect CTA */}
            {pageUrl && result.selector && (
              <div className="px-5 pt-4 shrink-0">
                <button
                  onClick={() => setShowPreview(true)}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 hover:bg-red-500/20 hover:border-red-500/50 transition-all text-sm font-medium group"
                >
                  <ScanSearch className="w-4 h-4 group-hover:scale-110 transition-transform" />
                  Highlight Element on Page
                </button>
                <p className="text-center text-[10px] text-slate-600 mt-1.5">
                  Opens a live preview and scrolls to the element automatically
                </p>
              </div>
            )}

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

              {/* Description */}
              <section>
                <h3 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <AlertCircle className="w-3 h-3" />
                  Issue
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">{result.description}</p>
              </section>

              {/* Affected HTML */}
              {result.element && (
                <section>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                      <Code2 className="w-3 h-3" />
                      Affected HTML
                    </h3>
                    <CopyButton text={result.element} label="HTML" />
                  </div>
                  <div className="relative">
                    <pre className="text-[11px] text-red-300 bg-red-500/5 border border-red-500/20 px-3 py-3 rounded-lg overflow-x-auto whitespace-pre-wrap break-all font-mono leading-relaxed">
                      {result.element}
                    </pre>
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-red-500/40 rounded-b-lg" />
                  </div>
                </section>
              )}

              {/* CSS Selector */}
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

              {/* Recommended Fix */}
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
            </div>

            {/* Footer */}
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
