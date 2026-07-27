import { useEffect } from "react";
import { X, PartyPopper, CheckCircle2, Sparkles } from "lucide-react";

interface CelebrationModalProps {
  onClose: () => void;
}

export function CelebrationModal({ onClose }: CelebrationModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-300"
        onClick={onClose}
      />

      {/* Confetti dots */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {Array.from({ length: 24 }).map((_, i) => {
          const colors = [
            "bg-emerald-400",
            "bg-teal-400",
            "bg-cyan-400",
            "bg-amber-400",
            "bg-rose-400",
            "bg-violet-400",
          ];
          const left = (i * 4.2) % 100;
          const delay = (i % 8) * 0.15;
          const duration = 2.5 + (i % 5) * 0.4;
          const color = colors[i % colors.length];
          const size = 6 + (i % 3) * 3;
          return (
            <span
              key={i}
              className={`absolute top-0 rounded-full ${color}`}
              style={{
                left: `${left}%`,
                width: `${size}px`,
                height: `${size}px`,
                animation: `confetti-fall ${duration}s ease-in ${delay}s infinite`,
              }}
            />
          );
        })}
      </div>

      {/* Modal */}
      <div className="relative w-full max-w-sm bg-slate-900 border border-emerald-500/30 rounded-3xl shadow-2xl shadow-emerald-500/10 p-8 animate-in fade-in zoom-in-95 duration-400">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full text-slate-500 hover:text-white hover:bg-slate-800 transition-colors"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Animated check badge */}
        <div className="flex justify-center mb-6">
          <div className="relative">
            {/* Pulsing rings */}
            <div className="absolute inset-0 rounded-full bg-emerald-500/20 animate-ping" />
            <div
              className="absolute inset-0 rounded-full bg-emerald-500/20 animate-ping"
              style={{ animationDelay: "0.5s" }}
            />
            {/* Badge */}
            <div className="relative w-20 h-20 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center shadow-lg shadow-emerald-500/40 animate-in zoom-in-50 duration-500">
              <CheckCircle2 className="w-10 h-10 text-white" strokeWidth={2.5} />
            </div>
          </div>
        </div>

        {/* Title with icon */}
        <div className="text-center mb-2">
          <div className="flex items-center justify-center gap-2 mb-2">
            <PartyPopper className="w-5 h-5 text-emerald-400 animate-in fade-in slide-in-from-bottom-2 duration-500 [animation-delay:200ms]" />
            <h2 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-emerald-300 via-teal-300 to-cyan-300 bg-clip-text text-transparent">
              Congratulations!
            </h2>
            <PartyPopper className="w-5 h-5 text-emerald-400 animate-in fade-in slide-in-from-bottom-2 duration-500 [animation-delay:300ms]" />
          </div>
        </div>

        {/* Message */}
        <p className="text-center text-slate-300 text-sm leading-relaxed mb-1">
            No violations were found.
        </p>
        <p className="text-center text-emerald-400 font-semibold text-base mb-6 flex items-center justify-center gap-1.5">
          <Sparkles className="w-4 h-4" />
          Your site is 100% ADA compliant!
          <Sparkles className="w-4 h-4" />
        </p>

        {/* Score badge */}
        <div className="flex justify-center mb-6">
          <div className="px-5 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/30">
            <span className="text-3xl font-bold text-emerald-400 font-mono">100</span>
            <span className="text-lg text-emerald-400/60 font-mono ml-0.5">/100</span>
          </div>
        </div>

        {/* Back to home button */}
        <button
          onClick={onClose}
          className="w-full py-3 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white text-sm font-semibold rounded-xl transition-all shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30 hover:scale-[1.02] active:scale-[0.98]"
        >
          Back to Home
        </button>

        <p className="text-center text-xs text-slate-500 mt-3">
          Press <kbd className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-slate-400 font-mono text-[10px]">Esc</kbd> to close
        </p>
      </div>
    </div>
  );
}
