import { Globe, Loader2, CheckCircle2, AlertTriangle, Radar, Sparkles } from "lucide-react";
import type { ScanData } from "../lib/types";

interface RescanOverlayProps {
  scanData: ScanData | null;
  scanId: string;
}

export function RescanOverlay({ scanData, scanId }: RescanOverlayProps) {
  const scan = scanData?.scan;
  const pages = scanData?.pages || [];
  const totalPages = scan?.total_pages || 0;
  const pagesScanned = scan?.pages_scanned || 0;
  const progress = totalPages > 0 ? (pagesScanned / totalPages) * 100 : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-950/80 backdrop-blur-md">
      {/* Ambient glow */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-emerald-500/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute top-1/3 left-1/4 w-72 h-72 bg-teal-500/10 rounded-full blur-3xl animate-pulse [animation-delay:1s]" />
        <div className="absolute bottom-1/4 right-1/4 w-72 h-72 bg-cyan-500/10 rounded-full blur-3xl animate-pulse [animation-delay:2s]" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Radar scanner */}
        <div className="relative mx-auto mb-8 w-48 h-48">
          {/* Concentric rings */}
          <div className="absolute inset-0 rounded-full border border-emerald-500/20" />
          <div className="absolute inset-6 rounded-full border border-emerald-500/15" />
          <div className="absolute inset-12 rounded-full border border-emerald-500/10" />
          <div className="absolute inset-20 rounded-full border border-emerald-500/10" />

          {/* Crosshair lines */}
          <div className="absolute top-1/2 left-0 right-0 h-px bg-emerald-500/15" />
          <div className="absolute left-1/2 top-0 bottom-0 w-px bg-emerald-500/15" />

          {/* Center dot */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 bg-emerald-400 rounded-full shadow-[0_0_12px_rgba(52,211,153,0.8)] z-10" />

          {/* Sweeping radar arm */}
          <div
            className="absolute inset-0 rounded-full origin-center"
            style={{
              background: "conic-gradient(from 0deg, transparent 0deg, rgba(52,211,153,0.35) 40deg, transparent 60deg)",
              animation: "radar-sweep 2.5s linear infinite",
            }}
          />

          {/* Orbiting blips */}
          <div className="absolute top-1/2 left-1/2 w-2 h-2 -mt-1 -ml-1">
            <div className="absolute w-full h-full animate-[orbit_3s_linear_infinite]">
              <div className="w-2 h-2 bg-teal-400 rounded-full shadow-[0_0_8px_rgba(45,212,191,0.9)]" />
            </div>
          </div>
          <div className="absolute top-1/2 left-1/2 w-2 h-2 -mt-1 -ml-1">
            <div className="absolute w-full h-full animate-[orbit_4.5s_linear_infinite_reverse]">
              <div className="w-1.5 h-1.5 bg-cyan-400 rounded-full shadow-[0_0_6px_rgba(34,211,238,0.9)]" />
            </div>
          </div>

          {/* Center icon */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20">
            <Radar className="w-6 h-6 text-emerald-300/70" />
          </div>
        </div>

        {/* Title */}
        <div className="text-center mb-6">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Sparkles className="w-4 h-4 text-emerald-400 animate-pulse" />
            <h2 className="text-xl font-bold tracking-tight bg-gradient-to-r from-emerald-300 via-teal-300 to-cyan-300 bg-clip-text text-transparent">
              Re-scanning website
            </h2>
            <Sparkles className="w-4 h-4 text-emerald-400 animate-pulse [animation-delay:0.5s]" />
          </div>
          <p className="text-slate-400 text-sm flex items-center justify-center gap-1.5">
            <Globe className="w-3.5 h-3.5" />
            <span className="truncate max-w-[260px]">{scan?.url || "Starting..."}</span>
          </p>
        </div>

        {/* Progress */}
        <div className="mb-5">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="text-slate-400">
              {pagesScanned} of {totalPages || "?"} pages
            </span>
            <span className="text-emerald-400 font-mono font-medium">
              {Math.round(progress)}%
            </span>
          </div>
          <div className="h-2 bg-slate-800/80 rounded-full overflow-hidden relative">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-400 rounded-full transition-all duration-500 ease-out relative"
              style={{ width: `${progress}%` }}
            >
              {/* Shimmer */}
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-[shimmer_1.5s_ease-in-out_infinite]" />
            </div>
          </div>
        </div>

        {/* Scan ID chip */}
        <div className="flex items-center justify-center gap-2 mb-5">
          <span className="text-xs text-slate-500">Scan</span>
          <code className="text-xs text-slate-400 font-mono px-2 py-0.5 bg-slate-800/60 rounded-md border border-slate-700/50">
            {scanId.slice(0, 8)}
          </code>
        </div>

        {/* Live page feed */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 flex items-center justify-between border-b border-slate-800/50">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Live Pages</span>
            <span className="text-xs text-slate-500">{pages.length} discovered</span>
          </div>
          <div className="max-h-44 overflow-y-auto divide-y divide-slate-800/40">
            {pages.length === 0 ? (
              <div className="px-4 py-6 flex items-center justify-center gap-2 text-slate-500">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-xs">Discovering pages...</span>
              </div>
            ) : (
              pages.map((page) => (
                <div
                  key={page.id}
                  className="px-4 py-2.5 flex items-center gap-3 animate-in fade-in slide-in-from-left-2 duration-300"
                >
                  {page.status === "completed" ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  ) : page.status === "running" ? (
                    <Loader2 className="w-3.5 h-3.5 text-teal-400 shrink-0 animate-spin" />
                  ) : page.status === "failed" ? (
                    <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                  ) : (
                    <Globe className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-slate-300 truncate">{page.title || page.url}</p>
                  </div>
                  {page.status === "completed" && page.score !== null && (
                    <span
                      className={`text-xs font-mono font-medium px-1.5 py-0.5 rounded ${
                        page.score >= 80
                          ? "bg-emerald-500/10 text-emerald-400"
                          : page.score >= 50
                          ? "bg-amber-500/10 text-amber-400"
                          : "bg-red-500/10 text-red-400"
                      }`}
                    >
                      {page.score}
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
