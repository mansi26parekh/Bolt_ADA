import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useScan } from "./hooks/useScan";
import { LandingPage } from "./components/LandingPage";
import { ScanningView } from "./components/ScanningView";
import { ResultsDashboard } from "./components/ResultsDashboard";
import { RescanOverlay } from "./components/RescanOverlay";
import { CelebrationModal } from "./components/CelebrationModal";
import { Sidebar, MobileMenuButton } from "./components/Sidebar";
import { Toast } from "./components/Toast";
import { ConfirmDialog } from "./components/ConfirmDialog";
import {
  ensureProject,
  getAllProjects,
  updateLastScan,
  deleteProject,
} from "./lib/projectService";
import {
  getActiveSchedules,
  createSchedule,
  updateSchedule,
  cancelSchedule,
} from "./lib/scheduleService";
import { ScheduleScanModal } from "./components/ScheduleScanModal";
import { ScheduleList } from "./components/ScheduleList";
import type { Project, ScanData, ScheduledScan, Recurrence } from "./lib/types";

const API_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ada-scan`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

function App() {
  const { view, scanData, scanId, error, isRescanning, previousScanData, startScan, rescan, goToResults, resetScan } = useScan();

  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [landingInitialUrl, setLandingInitialUrl] = useState<string>("");
  const [pendingDeleteProject, setPendingDeleteProject] = useState<Project | null>(null);
  const [sharedScanData, setSharedScanData] = useState<ScanData | null>(null);
  const [pendingRescan, setPendingRescan] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const [schedules, setSchedules] = useState<ScheduledScan[]>([]);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showScheduleList, setShowScheduleList] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<ScheduledScan | null>(null);
  const celebratedScanId = useRef<string | null>(null);

  const sharedScanId = new URLSearchParams(window.location.search).get("scan");
  const isSharedView = Boolean(sharedScanId);

  // Load projects + schedules on mount
  useEffect(() => {
    getAllProjects().then(setProjects).catch(() => {});
    getActiveSchedules().then(setSchedules).catch(() => {});
  }, []);

  useEffect(() => {
    if (!sharedScanId) return;
    let cancelled = false;
    fetch(`${API_URL}/${sharedScanId}`, {
      headers: {
        "Content-Type": "application/json",
        "apikey": ANON_KEY,
        "Authorization": `Bearer ${ANON_KEY}`,
      },
    })
      .then((res) => res.json())
      .then((data: ScanData) => { if (!cancelled) setSharedScanData(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedScanId]);

  // When a scan starts (scanId appears), record it on the active project
  useEffect(() => {
    if (!scanId || !activeProjectId) return;
    updateLastScan(activeProjectId, scanId)
      .then(() =>
        getAllProjects().then((list) => {
          setProjects(list);
          const updated = list.find((p) => p.id === activeProjectId);
          if (updated) setActiveProjectId(updated.id);
        })
      )
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanId]);

  const handleStartScan = useCallback(
    async (url: string, maxDepth: number) => {
      try {
        const { project, alreadyExisted } = await ensureProject(url);
        const isDifferentProject = project.id !== activeProjectId;
        setActiveProjectId(project.id);

        if (alreadyExisted && isDifferentProject) {
          setToastMessage("Project already exists. Opening existing project.");
          getAllProjects().then(setProjects).catch(() => {});
        } else if (!alreadyExisted) {
          setProjects((prev) =>
            [...prev, project].sort((a, b) => a.name.localeCompare(b.name))
          );
        }
      } catch {
        // Project creation failure is non-blocking — scan still proceeds
      }

      startScan(url, maxDepth);
    },
    [startScan, activeProjectId]
  );

  const handleSelectProject = useCallback(
    (project: Project) => {
      setActiveProjectId(project.id);
      if (project.last_scan_id) {
        goToResults(project.last_scan_id);
      } else {
        setLandingInitialUrl(project.url);
        resetScan();
      }
    },
    [goToResults, resetScan]
  );

  const handleNewScan = useCallback(() => {
    setLandingInitialUrl("");
    resetScan();
  }, [resetScan]);

  const handleDeleteProject = useCallback((project: Project) => {
    setPendingDeleteProject(project);
  }, []);

  const confirmDeleteProject = useCallback(async () => {
    if (!pendingDeleteProject) return;
    const id = pendingDeleteProject.id;
    setPendingDeleteProject(null);
    try {
      await deleteProject(id);
      setProjects((prev) => prev.filter((p) => p.id !== id));
      if (activeProjectId === id) {
        setActiveProjectId(null);
        setLandingInitialUrl("");
        resetScan();
      }
    } catch {
      // deletion failed silently
    }
  }, [pendingDeleteProject, activeProjectId, resetScan]);

  const activeScheduleForProject = useMemo(
    () => schedules.find((s) => s.project_id === activeProjectId),
    [schedules, activeProjectId],
  );

  const handleScheduleScan = useCallback(() => {
    if (activeScheduleForProject) {
      setShowScheduleList(true);
    } else {
      setEditingSchedule(null);
      setShowScheduleModal(true);
    }
  }, [activeScheduleForProject]);

  const handleScheduleSubmit = useCallback(
    async (data: {
      projectId: string;
      email: string;
      recurrence: Recurrence;
      nextScanAt: string;
      editId?: string;
    }) => {
      if (data.editId) {
        await updateSchedule(data.editId, {
          email: data.email,
          recurrence: data.recurrence,
          next_scan_at: data.nextScanAt,
        });
      } else {
        await createSchedule(data.projectId, data.email, data.recurrence, data.nextScanAt);
      }
      const list = await getActiveSchedules();
      setSchedules(list);
      setShowScheduleModal(false);
      setShowScheduleList(false);
      setEditingSchedule(null);

      const d = new Date(data.nextScanAt);
      const dateStr = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      const timeStr = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      setToastMessage(`Your next scan is scheduled for ${dateStr} at ${timeStr}.`);
    },
    [],
  );

  const handleCancelSchedule = useCallback(async (schedule: ScheduledScan) => {
    await cancelSchedule(schedule.id);
    const list = await getActiveSchedules();
    setSchedules(list);
    setToastMessage("Schedule cancelled.");
  }, []);

  const handleEditSchedule = useCallback((schedule: ScheduledScan) => {
    setEditingSchedule(schedule);
    setShowScheduleList(false);
    setShowScheduleModal(true);
  }, []);

  // Show the celebration modal when a scan completes with zero violations.
  useEffect(() => {
    if (
      scanData &&
      scanData.scan.status === "completed" &&
      scanData.results.length === 0 &&
      scanData.scan.id !== celebratedScanId.current
    ) {
      celebratedScanId.current = scanData.scan.id;
      setShowCelebration(true);
    }
  }, [scanData]);

  const closeCelebration = useCallback(() => {
    setShowCelebration(false);
    handleNewScan();
  }, [handleNewScan]);

  const showSidebar = view !== "landing" && !isSharedView;

  return (
    <div className="flex h-screen overflow-hidden bg-slate-950">
      {showSidebar && (
        <>
          <MobileMenuButton onClick={() => setMobileSidebarOpen(true)} />
          <Sidebar
            projects={projects}
            activeProjectId={activeProjectId}
            onSelectProject={(p) => { handleSelectProject(p); setMobileSidebarOpen(false); }}
            onDeleteProject={handleDeleteProject}
            onNewScan={() => { handleNewScan(); setMobileSidebarOpen(false); }}
            mobileOpen={mobileSidebarOpen}
            onMobileClose={() => setMobileSidebarOpen(false)}
          />
        </>
      )}

      <div className="flex-1 overflow-auto">
        {isSharedView ? (
          sharedScanData ? (
            <ResultsDashboard scanData={sharedScanData} onReset={() => {}} onToast={setToastMessage} />
          ) : (
            <div className="flex items-center justify-center h-full text-slate-400">
              <p className="text-sm">Loading shared report…</p>
            </div>
          )
        ) : view === "scanning" && scanId ? (
          isRescanning ? (
            <>
              <ResultsDashboard
                scanData={previousScanData || scanData}
                onReset={handleNewScan}
                onToast={setToastMessage}
                onRescan={() => setPendingRescan(true)}
                isRescanning
                onScheduleScan={handleScheduleScan}
                hasActiveSchedule={Boolean(activeScheduleForProject)}
              />
              <RescanOverlay scanData={scanData} scanId={scanId} />
            </>
          ) : (
            <ScanningView scanData={scanData} scanId={scanId} />
          )
        ) : view === "results" && scanData ? (
          <ResultsDashboard scanData={scanData} onReset={handleNewScan} onToast={setToastMessage} onRescan={() => setPendingRescan(true)} isRescanning={false} onScheduleScan={handleScheduleScan} hasActiveSchedule={Boolean(activeScheduleForProject)} />
        ) : (
          <LandingPage
            onStartScan={handleStartScan}
            error={error}
            initialUrl={landingInitialUrl}
            projects={projects}
            onSelectProject={handleSelectProject}
          />
        )}
      </div>

      {toastMessage && (
        <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} />
      )}

      {pendingDeleteProject && (
        <ConfirmDialog
          title={`Delete "${pendingDeleteProject.name}"?`}
          message="This project will be permanently removed. Any scans already run are not affected."
          confirmLabel="Delete Project"
          onConfirm={confirmDeleteProject}
          onCancel={() => setPendingDeleteProject(null)}
        />
      )}

      {showCelebration && (
        <CelebrationModal onClose={closeCelebration} />
      )}

      {pendingRescan && (
        <ConfirmDialog
          title="Re-scan website?"
          message="Do you want to run a new accessibility scan?"
          confirmLabel="Start Re-scan"
          onConfirm={() => {
            setPendingRescan(false);
            rescan();
          }}
          onCancel={() => setPendingRescan(false)}
        />
      )}

      {showScheduleModal && (
        <ScheduleScanModal
          projects={projects}
          existingSchedules={schedules}
          editingSchedule={editingSchedule}
          onSubmit={handleScheduleSubmit}
          onClose={() => {
            setShowScheduleModal(false);
            setEditingSchedule(null);
          }}
        />
      )}

      {showScheduleList && (
        <ScheduleList
          schedules={schedules}
          projects={projects}
          onEdit={handleEditSchedule}
          onCancel={handleCancelSchedule}
          onClose={() => setShowScheduleList(false)}
        />
      )}
    </div>
  );
}

export default App;
