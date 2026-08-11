import { useState, useEffect, useMemo } from "react";
import {
  X,
  Clock,
  CalendarDays,
  Mail,
  ChevronDown,
  FolderOpen,
  Loader2,
} from "lucide-react";
import type { Project, Recurrence, ScheduledScan } from "../lib/types";

const RECURRENCE_OPTIONS: { value: Recurrence; label: string }[] = [
  { value: "monthly", label: "Monthly" },
  { value: "every_3_months", label: "Every 3 Months" },
  { value: "yearly", label: "Yearly" },
];

function toLocalDateStr(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function toLocalTimeStr(d: Date) {
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

interface Props {
  projects: Project[];
  existingSchedules: ScheduledScan[];
  editingSchedule?: ScheduledScan | null;
  onSubmit: (data: {
    projectId: string;
    email: string;
    recurrence: Recurrence;
    nextScanAt: string;
    editId?: string;
  }) => Promise<void>;
  onClose: () => void;
}

export function ScheduleScanModal({
  projects,
  existingSchedules,
  editingSchedule,
  onSubmit,
  onClose,
}: Props) {
  const isEditing = Boolean(editingSchedule);

  const tomorrow = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d;
  }, []);

  const [projectId, setProjectId] = useState(editingSchedule?.project_id ?? "");
  const [email, setEmail] = useState(editingSchedule?.email ?? "");
  const [recurrence, setRecurrence] = useState<Recurrence>(
    editingSchedule?.recurrence ?? "monthly",
  );
  const [date, setDate] = useState(
    editingSchedule
      ? toLocalDateStr(new Date(editingSchedule.next_scan_at))
      : toLocalDateStr(tomorrow),
  );
  const [time, setTime] = useState(
    editingSchedule
      ? toLocalTimeStr(new Date(editingSchedule.next_scan_at))
      : toLocalTimeStr(tomorrow),
  );
  const [submitting, setSubmitting] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);

  const scheduledProjectIds = useMemo(() => {
    const set = new Set(existingSchedules.map((s) => s.project_id));
    if (editingSchedule) set.delete(editingSchedule.project_id);
    return set;
  }, [existingSchedules, editingSchedule]);

  const availableProjects = useMemo(
    () => projects.filter((p) => !scheduledProjectIds.has(p.id)),
    [projects, scheduledProjectIds],
  );

  useEffect(() => {
    if (!projectId && availableProjects.length > 0 && !isEditing) {
      setProjectId(availableProjects[0].id);
    }
  }, [availableProjects, projectId, isEditing]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const emailValid = EMAIL_RE.test(email.trim());
  const dateInFuture = (() => {
    const d = new Date(`${date}T${time}`);
    return d.getTime() > Date.now();
  })();
  const canSubmit = projectId && emailValid && dateInFuture && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const nextScanAt = new Date(`${date}T${time}`).toISOString();
      await onSubmit({
        projectId,
        email: email.trim(),
        recurrence,
        nextScanAt,
        editId: editingSchedule?.id,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const minDate = toLocalDateStr(new Date());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative w-full max-w-md bg-slate-900 border border-slate-700/60 rounded-2xl shadow-2xl animate-in fade-in zoom-in-95 duration-150 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-800/50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <Clock className="w-4.5 h-4.5 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">
                {isEditing ? "Edit Schedule" : "Schedule Scan"}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Automate recurring accessibility audits
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

        {/* Body */}
        <div className="px-6 py-5 space-y-5">
          {/* Project */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-400 block">
              Project
            </label>
            <div className="relative">
              <FolderOpen className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                disabled={isEditing}
                className="w-full appearance-none bg-slate-800/80 border border-slate-700 rounded-lg pl-9 pr-9 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/50 transition-all disabled:opacity-60"
              >
                {availableProjects.length === 0 && !isEditing ? (
                  <option value="">No projects available</option>
                ) : isEditing ? (
                  <option value={editingSchedule!.project_id}>
                    {projects.find((p) => p.id === editingSchedule!.project_id)?.name ??
                      "Unknown"}
                  </option>
                ) : (
                  availableProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))
                )}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
            </div>
          </div>

          {/* Date + Time row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-400 block">
                First Scan Date
              </label>
              <div className="relative">
                <CalendarDays className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                <input
                  type="date"
                  value={date}
                  min={minDate}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full bg-slate-800/80 border border-slate-700 rounded-lg pl-9 pr-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/50 transition-all [color-scheme:dark]"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-400 block">
                Time
              </label>
              <div className="relative">
                <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="w-full bg-slate-800/80 border border-slate-700 rounded-lg pl-9 pr-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/50 transition-all [color-scheme:dark]"
                />
              </div>
            </div>
          </div>

          {/* Recurrence */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-400 block">
              Recurrence
            </label>
            <div className="grid grid-cols-3 gap-2">
              {RECURRENCE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setRecurrence(opt.value)}
                  className={`px-3 py-2 rounded-lg text-xs font-medium border transition-all ${
                    recurrence === opt.value
                      ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-300"
                      : "bg-slate-800/60 border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-300"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Email */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-400 block">
              Email Address
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => setEmailTouched(true)}
                placeholder="you@company.com"
                className={`w-full bg-slate-800/80 border rounded-lg pl-9 pr-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 transition-all ${
                  emailTouched && !emailValid
                    ? "border-red-500/50 focus:ring-red-500/30"
                    : "border-slate-700 focus:ring-emerald-500/40 focus:border-emerald-500/50"
                }`}
              />
            </div>
            {emailTouched && !emailValid && email.length > 0 ? (
              <p className="text-[11px] text-red-400">
                Please enter a valid email address.
              </p>
            ) : (
              <p className="text-[11px] text-slate-600">
                Your completed scan report will be sent to this email.
              </p>
            )}
          </div>

          {!dateInFuture && date && time && (
            <p className="text-[11px] text-red-400">
              The scheduled date and time must be in the future.
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-5 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-600/40 disabled:cursor-not-allowed border border-emerald-500/50 rounded-lg transition-colors shadow-sm"
          >
            {submitting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Scheduling...
              </>
            ) : (
              <>
                <Clock className="w-3.5 h-3.5" />
                {isEditing ? "Update Schedule" : "Schedule Scan"}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
