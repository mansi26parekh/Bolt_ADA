import { Shield, FolderOpen, Folder, Plus, X, FileBarChart } from "lucide-react";
import type { Project, ScanSummary } from "../lib/types";

interface SidebarProps {
  projects: Project[];
  activeProjectId: string | null;
  projectScans: ScanSummary[];
  currentScanId: string | null;
  onSelectProject: (project: Project) => void;
  onDeleteProject: (project: Project) => void;
  onSelectScan: (scanId: string) => void;
  onNewScan: () => void;
}

function formatScanDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function scoreColor(score: number | null): string {
  if (score === null) return "text-slate-500";
  if (score >= 80) return "text-emerald-400";
  if (score >= 50) return "text-amber-400";
  return "text-red-400";
}

export function Sidebar({
  projects,
  activeProjectId,
  projectScans,
  currentScanId,
  onSelectProject,
  onDeleteProject,
  onSelectScan,
  onNewScan,
}: SidebarProps) {
  return (
    <aside className="w-52 shrink-0 flex flex-col bg-slate-950 border-r border-slate-800/60 h-screen sticky top-0 overflow-hidden">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 h-14 border-b border-slate-800/60 shrink-0">
        <div className="w-7 h-7 bg-emerald-500 rounded-md flex items-center justify-center shrink-0">
          <Shield className="w-4 h-4 text-white" />
        </div>
        <span className="text-sm font-semibold tracking-tight text-white">ADA Scanner</span>
      </div>

      {/* New Scan button */}
      <div className="px-3 pt-3 pb-2 shrink-0">
        <button
          onClick={onNewScan}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-300 hover:text-white bg-slate-800/50 hover:bg-slate-800 border border-slate-700/50 hover:border-slate-600 rounded-lg transition-all"
        >
          <Plus className="w-3.5 h-3.5 text-emerald-400" />
          New Scan
        </button>
      </div>

      {/* Projects section */}
      <div className="flex-1 overflow-y-auto px-3 pb-4">
        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider px-1 mb-2 mt-1">
          Projects
        </p>

        {projects.length === 0 ? (
          <p className="text-[11px] text-slate-600 px-1 leading-relaxed">
            No projects yet. Start a scan to create one.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {projects.map((project) => {
              const isActive = project.id === activeProjectId;
              const showScans = isActive && projectScans.length > 0;

              return (
                <li key={project.id}>
                  {/* Project row */}
                  <div
                    className={`group flex items-center rounded-lg transition-all ${
                      isActive
                        ? "bg-emerald-500/15 border border-emerald-500/25"
                        : "border border-transparent hover:bg-slate-800/60"
                    }`}
                  >
                    <button
                      onClick={() => onSelectProject(project)}
                      className={`flex-1 flex items-center gap-2 px-2.5 py-2 text-left min-w-0 ${
                        isActive ? "text-emerald-300" : "text-slate-400 group-hover:text-white"
                      }`}
                    >
                      {isActive ? (
                        <FolderOpen className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
                      ) : (
                        <Folder className="w-3.5 h-3.5 shrink-0 text-slate-500 group-hover:text-slate-300" />
                      )}
                      <span className="text-xs font-medium truncate capitalize">{project.name}</span>
                    </button>

                    <button
                      onClick={(e) => { e.stopPropagation(); onDeleteProject(project); }}
                      className="shrink-0 p-1.5 mr-1 rounded-md opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all"
                      title="Delete project"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>

                  {/* Scan history tree — only for active project */}
                  {showScans && (
                    <ul className="ml-3 mt-0.5 mb-1 pl-3 border-l border-slate-800 space-y-0.5">
                      {projectScans.map((scan) => {
                        const isCurrent = scan.id === currentScanId;
                        return (
                          <li key={scan.id}>
                            <button
                              onClick={() => onSelectScan(scan.id)}
                              className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-left transition-all ${
                                isCurrent
                                  ? "bg-slate-700/50 text-white"
                                  : "text-slate-500 hover:text-slate-300 hover:bg-slate-800/50"
                              }`}
                            >
                              <FileBarChart className={`w-3 h-3 shrink-0 ${isCurrent ? "text-emerald-400" : "text-slate-600"}`} />
                              <span className="text-[11px] flex-1 truncate leading-none">
                                {formatScanDate(scan.created_at)}
                              </span>
                              {scan.score !== null && (
                                <span className={`text-[10px] font-bold tabular-nums ${scoreColor(scan.score)}`}>
                                  {scan.score}
                                </span>
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
