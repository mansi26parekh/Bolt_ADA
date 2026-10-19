import { useState, useEffect, useCallback, useRef } from "react";
import { X, ChevronLeft, ChevronRight, Check } from "lucide-react";

export interface TourStep {
  selector: string;
  title: string;
  body: string;
  placement?: "top" | "bottom" | "left" | "right" | "center";
}

interface TourOverlayProps {
  steps: TourStep[];
  currentStep: number;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
  onFinish: () => void;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PADDING = 6;
const TOOLTIP_OFFSET = 16;

export function TourOverlay({
  steps,
  currentStep,
  onNext,
  onBack,
  onSkip,
  onFinish,
}: TourOverlayProps) {
  const [targetRect, setTargetRect] = useState<Rect | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number } | null>(null);
  const [viewportReady, setViewportReady] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const step = steps[currentStep];
  const isLast = currentStep === steps.length - 1;
  const placement = step?.placement ?? "bottom";

  const computePosition = useCallback(() => {
    if (!step) return;
    const el = document.querySelector(step.selector) as HTMLElement | null;
    if (!el) {
      setTargetRect(null);
      setTooltipPos(null);
      return;
    }

    el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });

    const rect = el.getBoundingClientRect();
    const padded: Rect = {
      top: rect.top - PADDING,
      left: rect.left - PADDING,
      width: rect.width + PADDING * 2,
      height: rect.height + PADDING * 2,
    };
    setTargetRect(padded);

    const tt = tooltipRef.current;
    const ttW = tt?.offsetWidth || 320;
    const ttH = tt?.offsetHeight || 200;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let top: number;
    let left: number;

    if (placement === "center") {
      top = vh / 2 - ttH / 2;
      left = vw / 2 - ttW / 2;
    } else if (placement === "top") {
      top = rect.top - ttH - TOOLTIP_OFFSET;
      left = rect.left + rect.width / 2 - ttW / 2;
    } else if (placement === "bottom") {
      top = rect.bottom + TOOLTIP_OFFSET;
      left = rect.left + rect.width / 2 - ttW / 2;
    } else if (placement === "left") {
      top = rect.top + rect.height / 2 - ttH / 2;
      left = rect.left - ttW - TOOLTIP_OFFSET;
    } else {
      top = rect.top + rect.height / 2 - ttH / 2;
      left = rect.right + TOOLTIP_OFFSET;
    }

    // Clamp within viewport with margin
    const margin = 12;
    left = Math.max(margin, Math.min(left, vw - ttW - margin));
    top = Math.max(margin, Math.min(top, vh - ttH - margin));

    setTooltipPos({ top, left });
  }, [step, placement]);

  useEffect(() => {
    setViewportReady(false);
    const timer = setTimeout(() => {
      computePosition();
      setViewportReady(true);
    }, 300);
    return () => clearTimeout(timer);
  }, [currentStep, computePosition]);

  useEffect(() => {
    const handler = () => computePosition();
    window.addEventListener("resize", handler);
    window.addEventListener("scroll", handler, true);
    return () => {
      window.removeEventListener("resize", handler);
      window.removeEventListener("scroll", handler, true);
    };
  }, [computePosition]);

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onSkip();
      } else if (e.key === "ArrowRight" || e.key === "Enter") {
        if (isLast) onFinish();
        else onNext();
      } else if (e.key === "ArrowLeft") {
        onBack();
      }
    },
    [isLast, onNext, onBack, onSkip, onFinish]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [handleKey]);

  if (!step) return null;

  const progress = ((currentStep + 1) / steps.length) * 100;

  return (
    <div
      className="fixed inset-0 z-[9999]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-title"
      aria-describedby="tour-body"
    >
      {/* Spotlight overlay */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ width: "100vw", height: "100vh" }}
      >
        <defs>
          <mask id="tour-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {targetRect && (
              <rect
                x={targetRect.left}
                y={targetRect.top}
                width={targetRect.width}
                height={targetRect.height}
                rx="8"
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="rgba(2, 6, 23, 0.78)"
          mask="url(#tour-mask)"
        />
      </svg>

      {/* Spotlight ring (border highlight) */}
      {targetRect && (
        <div
          className="absolute pointer-events-none rounded-lg ring-2 ring-emerald-400 transition-all duration-300"
          style={{
            top: targetRect.top,
            left: targetRect.left,
            width: targetRect.width,
            height: targetRect.height,
            boxShadow: "0 0 0 9999px rgba(2, 6, 23, 0.78)",
            borderRadius: 8,
          }}
        />
      )}

      {/* Tooltip */}
      {tooltipPos && viewportReady && (
        <div
          ref={tooltipRef}
          className="absolute w-[320px] max-w-[calc(100vw-24px)] bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"
          style={{ top: tooltipPos.top, left: tooltipPos.left }}
        >
          {/* Progress bar */}
          <div className="h-1 bg-slate-800">
            <div
              className="h-full bg-emerald-500 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>

          {/* Header */}
          <div className="flex items-start justify-between px-5 pt-4 pb-2">
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider mb-1">
                Step {currentStep + 1} of {steps.length}
              </p>
              <h3 id="tour-title" className="text-base font-bold text-white leading-tight">
                {step.title}
              </h3>
            </div>
            <button
              onClick={onSkip}
              className="shrink-0 ml-3 w-7 h-7 rounded-full text-slate-500 hover:text-white hover:bg-slate-800 flex items-center justify-center transition-colors"
              aria-label="Skip tour"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="px-5 pb-4">
            <p id="tour-body" className="text-sm text-slate-400 leading-relaxed">
              {step.body}
            </p>
          </div>

          {/* Controls */}
          <div className="flex items-center justify-between px-5 py-3 border-t border-slate-800 bg-slate-950/50">
            <div className="flex items-center gap-1.5">
              {steps.map((_, i) => (
                <div
                  key={i}
                  className={`h-1.5 rounded-full transition-all ${
                    i === currentStep
                      ? "w-5 bg-emerald-400"
                      : i < currentStep
                      ? "w-1.5 bg-emerald-600"
                      : "w-1.5 bg-slate-700"
                  }`}
                />
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={onSkip}
                className="px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors"
              >
                Skip
              </button>
              {currentStep > 0 && (
                <button
                  onClick={onBack}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  Back
                </button>
              )}
              {isLast ? (
                <button
                  onClick={onFinish}
                  className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-emerald-500 hover:bg-emerald-400 rounded-lg transition-colors shadow-sm shadow-emerald-500/20"
                >
                  <Check className="w-3.5 h-3.5" />
                  Finish
                </button>
              ) : (
                <button
                  onClick={onNext}
                  className="flex items-center gap-1 px-4 py-1.5 text-xs font-semibold text-white bg-emerald-500 hover:bg-emerald-400 rounded-lg transition-colors shadow-sm shadow-emerald-500/20"
                >
                  Next
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Center tooltip when target not found */}
      {!tooltipPos && viewportReady && (
        <div
          ref={tooltipRef}
          className="absolute w-[320px] max-w-[calc(100vw-24px)] bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"
          style={{
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
          }}
        >
          <div className="h-1 bg-slate-800">
            <div className="h-full bg-emerald-500 transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
          <div className="flex items-start justify-between px-5 pt-4 pb-2">
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider mb-1">
                Step {currentStep + 1} of {steps.length}
              </p>
              <h3 id="tour-title" className="text-base font-bold text-white leading-tight">{step.title}</h3>
            </div>
            <button onClick={onSkip} className="shrink-0 ml-3 w-7 h-7 rounded-full text-slate-500 hover:text-white hover:bg-slate-800 flex items-center justify-center transition-colors" aria-label="Skip tour">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="px-5 pb-4">
            <p id="tour-body" className="text-sm text-slate-400 leading-relaxed">{step.body}</p>
          </div>
          <div className="flex items-center justify-between px-5 py-3 border-t border-slate-800 bg-slate-950/50">
            <div className="flex items-center gap-1.5">
              {steps.map((_, i) => (
                <div key={i} className={`h-1.5 rounded-full transition-all ${i === currentStep ? "w-5 bg-emerald-400" : i < currentStep ? "w-1.5 bg-emerald-600" : "w-1.5 bg-slate-700"}`} />
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={onSkip} className="px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors">Skip</button>
              {currentStep > 0 && (
                <button onClick={onBack} className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors">
                  <ChevronLeft className="w-3.5 h-3.5" />Back
                </button>
              )}
              {isLast ? (
                <button onClick={onFinish} className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-emerald-500 hover:bg-emerald-400 rounded-lg transition-colors shadow-sm shadow-emerald-500/20">
                  <Check className="w-3.5 h-3.5" />Finish
                </button>
              ) : (
                <button onClick={onNext} className="flex items-center gap-1 px-4 py-1.5 text-xs font-semibold text-white bg-emerald-500 hover:bg-emerald-400 rounded-lg transition-colors shadow-sm shadow-emerald-500/20">
                  Next<ChevronRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
