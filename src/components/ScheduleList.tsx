import { useState } from "react";
import {
  CalendarDays,
  Clock,
  Pencil,
  Trash2,
  RefreshCw,
  Mail,
  X,
} from "lucide-react";
import type { Project, ScheduledScan, Recurrence } from "../lib/types";

const RECURRENCE_LABELS: Record<Recurrence, string> = {
  monthly: "Monthly",
  every_3_months: "Every 3 Months",
  yearly: "Yearly",
};

function formatNextScan(iso: string) {
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

interface Props {
  schedules: ScheduledScan[];
  projects: Project[];
  onEdit: (schedule: ScheduledScan) => void;
  onCancel: (schedule: ScheduledScan) => void;
  onClose: () => void;
}

export function ScheduleList({
  schedules,
  projects,
  onEdit,
  onCancel,
  onClose,
}: Props) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const projectMap = new Map(projects.map((p) => [p.id, p]));

  if (schedules.length === 0) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
        <div className="relative w-full max-w-md bg-slate-900 border border-slate-700/60 rounded-2xl shadow-2xl animate-in fade-in zoom-in-95 duration-150 p-8 text-center">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-8 h-8 rounded-full text-slate-500 hover:text-white hover:bg-slate-800 flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
          <div className="w-12 h-12 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center mx-auto mb-4">
            <CalendarDays className="w-6 h-6 text-slate-500" />
          </div>
          <h3 className="text-base font-semibold text-white mb-1">No Active Schedules</h3>
          <p className="text-sm text-slate-400">
            Schedule a scan to automate recurring accessibility audits.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-lg bg-slate-900 border border-slate-700/60 rounded-2xl shadow-2xl animate-in fade-in zoom-in-95 duration-150 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-800/50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <CalendarDays className="w-4.5 h-4.5 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Active Schedules</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {schedules.length} schedule{schedules.length !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full text-slate-500 hover:text-white hover:bg-slate-800 flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* List */}
        <div className="px-4 py-4 space-y-3 max-h-[60vh] overflow-y-auto">
          {schedules.map((schedule) => {
            const project = projectMap.get(schedule.project_id);
            const isConfirming = confirmingId === schedule.id;

            return (
              <div
                key={schedule.id}
                className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-white truncate">
                      {project?.name ?? "Unknown Project"}
                    </p>
                    <p className="text-xs text-slate-500 truncate mt-0.5">
                      {project?.url ?? "—"}
                    </p>
                  </div>
                  <span className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-[11px] font-medium text-emerald-400">
                    <RefreshCw className="w-3 h-3" />
                    {RECURRENCE_LABELS[schedule.recurrence]}
                  </span>
                </div>

                <div className="flex items-center gap-4 text-xs text-slate-400">
                  <span className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-slate-500" />
                    {formatNextScan(schedule.next_scan_at)}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-slate-500" />
                    <span className="truncate max-w-[180px]">{schedule.email}</span>
                  </span>
                </div>

                <div className="flex items-center gap-2 pt-1 border-t border-slate-700/40">
                  <button
                    onClick={() => onEdit(schedule)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-slate-300 bg-slate-700/50 hover:bg-slate-700 border border-slate-600/50 rounded-lg transition-colors"
                  >
                    <Pencil className="w-3 h-3" />
                    Edit
                  </button>
                  {isConfirming ? (
                    <div className="flex items-center gap-2 ml-auto">
                      <span className="text-[11px] text-slate-400">Cancel this schedule?</span>
                      <button
                        onClick={() => {
                          onCancel(schedule);
                          setConfirmingId(null);
                        }}
                        className="px-3 py-1.5 text-[11px] font-medium text-white bg-red-500/80 hover:bg-red-500 border border-red-500/50 rounded-lg transition-colors"
                      >
                        Yes, cancel
                      </button>
                      <button
                        onClick={() => setConfirmingId(null)}
                        className="px-3 py-1.5 text-[11px] font-medium text-slate-400 bg-slate-700/50 hover:bg-slate-700 border border-slate-600/50 rounded-lg transition-colors"
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmingId(schedule.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                      Cancel Schedule
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
