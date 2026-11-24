import { useEffect, useState } from "react";
import { Sparkles, Copy, Check, ImageOff, Loader2, RefreshCw, ExternalLink, KeyRound } from "lucide-react";
import type { ScanResult } from "../lib/types";
import { type AltSuggestion, altAttribute, resolveImageSource, withAltAttribute } from "../lib/altTextService";

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copy this value:", value);
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy ${label}`}
      className={`shrink-0 inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md border transition-colors ${
        copied
          ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
          : "bg-slate-800 text-slate-400 border-slate-700 hover:text-white hover:border-slate-500"
      }`}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function Row({ label, value, copyLabel, children }: { label: string; value: string; copyLabel: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-24 shrink-0 pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <div className="flex-1 min-w-0 flex items-start gap-2">
        <code className="flex-1 min-w-0 text-[12px] font-mono text-slate-300 bg-slate-950/70 border border-slate-700/60 rounded-md px-2 py-1 break-all leading-relaxed">
          {value}
        </code>
        {children}
        <CopyButton value={value} label={copyLabel} />
      </div>
    </div>
  );
}

interface AltTextPanelProps {
  result: ScanResult;
  pageUrl: string;
  suggestion: AltSuggestion | undefined;
  onRequest: (resultId: string, force?: boolean) => void;
}

export function AltTextPanel({ result, pageUrl, suggestion, onRequest }: AltTextPanelProps) {
  const element = result.element ?? "";
  const imageUrl = resolveImageSource(element, pageUrl);
  const [previewFailed, setPreviewFailed] = useState(false);

  useEffect(() => {
    onRequest(result.id);
  }, [result.id, onRequest]);

  return (
    <div className="mx-4 mb-3 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.03] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-emerald-500/15 bg-emerald-500/[0.05]">
        <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
        <span className="text-xs font-semibold text-emerald-300">Image details &amp; AI alt text</span>
      </div>

      <div className="p-3 flex flex-col sm:flex-row gap-4">
        <div className="shrink-0 w-full sm:w-36 h-36 rounded-md border border-slate-700/60 bg-[repeating-conic-gradient(#1e293b_0%_25%,#0f172a_0%_50%)] bg-[length:16px_16px] flex items-center justify-center overflow-hidden">
          {imageUrl && !previewFailed ? (
            <img
              src={imageUrl}
              alt={suggestion?.status === "ready" ? suggestion.altText : ""}
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => setPreviewFailed(true)}
              className="max-w-full max-h-full object-contain"
            />
          ) : (
            <div className="flex flex-col items-center gap-1.5 text-slate-500">
              <ImageOff className="w-6 h-6" />
              <span className="text-[11px]">Preview unavailable</span>
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0 space-y-2">
          {imageUrl && (
            <Row label="Source URL" value={imageUrl} copyLabel="image source URL">
              <a
                href={imageUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open image in a new tab"
                className="shrink-0 inline-flex items-center px-2 py-1 rounded-md border bg-slate-800 text-slate-400 border-slate-700 hover:text-white hover:border-slate-500 transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
              </a>
            </Row>
          )}
          {element && <Row label="HTML" value={element} copyLabel="detected HTML" />}
          {result.selector && <Row label="CSS selector" value={result.selector} copyLabel="CSS selector" />}

          <div className="pt-2 mt-1 border-t border-slate-800/80">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-400">Recommended alt text</span>
              {suggestion?.status === "ready" && suggestion.decorative && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30">
                  Decorative
                </span>
              )}
            </div>

            {(!suggestion || suggestion.status === "loading") && (
              <div className="flex items-center gap-2 text-xs text-slate-400 py-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                Analysing the image and page context...
              </div>
            )}

            {suggestion?.status === "error" && (
              <div className="flex flex-wrap items-center gap-2 text-xs py-1">
                {suggestion.notConfigured ? (
                  <span className="flex items-center gap-1.5 text-amber-300">
                    <KeyRound className="w-3.5 h-3.5" />
                    AI alt text needs a Gemini key to be added before it can run.
                  </span>
                ) : (
                  <>
                    <span className="text-slate-400">{suggestion.message}</span>
                    <button
                      type="button"
                      onClick={() => onRequest(result.id, true)}
                      className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md bg-slate-800 text-slate-300 border border-slate-700 hover:text-white hover:border-slate-500 transition-colors"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Retry
                    </button>
                  </>
                )}
              </div>
            )}

            {suggestion?.status === "ready" && (
              <div className="space-y-2">
                <p className="text-sm text-slate-100 leading-relaxed">
                  {suggestion.decorative
                    ? "This image appears to be decorative. Use an empty alt so screen readers skip it."
                    : `"${suggestion.altText}"`}
                </p>
                <Row label="Attribute" value={altAttribute(suggestion.altText)} copyLabel="alt attribute" />
                {element && (
                  <Row label="Fixed HTML" value={withAltAttribute(element, suggestion.altText)} copyLabel="fixed HTML" />
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
