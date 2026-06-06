import { Globe, Search, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import type { ScanData } from "../lib/types";

interface ScanningViewProps {
  scanData: ScanData | null;
  scanId: string;
}

export function ScanningView({ scanData, scanId }: ScanningViewProps) {
  const scan = scanData?.scan;
  const pages = scanData?.pages || [];
  const totalPages = scan?.total_pages || 0;
  const pagesScanned = scan?.pages_scanned || 0;
  const progress = totalPages > 0 ? (pagesScanned / totalPages) * 100 : 0;

  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="w-16 h-16 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex items-center justify-center mx-auto mb-5">
            <Search className="w-7 h-7 text-emerald-400 animate-pulse" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight mb-2">Scanning your site</h1>
          <p className="text-slate-400 text-sm">
            {scan?.url || "Starting scan..."}
          </p>
        </div>

        {/* Progress Bar */}
        <div className="mb-8">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-slate-400">
              {pagesScanned} of {totalPages || "?"} pages scanned
            </span>
            <span className="text-emerald-400 font-mono">
              {Math.round(progress)}%
            </span>
          </div>
          <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Scan ID */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 mb-6">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">Scan ID</span>
            <code className="text-xs text-slate-400 font-mono">{scanId.slice(0, 8)}...</code>
          </div>
        </div>

        {/* Page List */}
        {pages.length > 0 && (
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl divide-y divide-slate-800/50">
            <div className="px-4 py-3 flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Pages</span>
              <span className="text-xs text-slate-500">{pages.length} discovered</span>
            </div>
            {pages.map((page) => (
              <div key={page.id} className="px-4 py-3 flex items-center gap-3">
                {page.status === "completed" ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : page.status === "running" ? (
                  <Loader2 className="w-4 h-4 text-teal-400 shrink-0 animate-spin" />
                ) : page.status === "failed" ? (
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                ) : (
                  <Globe className="w-4 h-4 text-slate-600 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-300 truncate">{page.title || page.url}</p>
                  <p className="text-xs text-slate-600 truncate">{page.url}</p>
                </div>
                {page.status === "completed" && page.score !== null && (
                  <span className={`text-xs font-mono font-medium px-2 py-0.5 rounded-md ${
                    page.score >= 80 ? "bg-emerald-500/10 text-emerald-400" :
                    page.score >= 50 ? "bg-amber-500/10 text-amber-400" :
                    "bg-red-500/10 text-red-400"
                  }`}>
                    {page.score}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Empty state while waiting */}
        {pages.length === 0 && (
          <div className="text-center py-8">
            <Loader2 className="w-6 h-6 text-slate-600 animate-spin mx-auto mb-3" />
            <p className="text-sm text-slate-500">Discovering pages to scan...</p>
          </div>
        )}
      </div>
    </div>
  );
}
