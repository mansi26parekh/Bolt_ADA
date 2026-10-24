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
import { TourOverlay } from "./components/TourOverlay";
import type { TourStep } from "./components/TourOverlay";
import { landingTourSteps, sidebarTourSteps, resultsTourSteps, scanningTourSteps, scheduleModalTourSteps } from "./lib/tourSteps";
import { hasTourBeenCompleted, markTourCompleted, resetTourCompletion } from "./lib/tourStorage";
import { HelpCircle } from "lucide-react";
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

  const [tourActive, setTourActive] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const [tourPhase, setTourPhase] = useState<"landing" | "scanning" | "sidebar" | "results" | "schedule">("landing");

  const sharedScanId = new URLSearchParams(window.location.search).get("scan");
  const isSharedView = Boolean(sharedScanId);

  // Auto-start tour on first visit
  useEffect(() => {
    if (!isSharedView && !hasTourBeenCompleted()) {
      const timer = setTimeout(() => {
        setTourActive(true);
        setTourStep(0);
        setTourPhase("landing");
      }, 800);
      return () => clearTimeout(timer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      try {
        if (data.editId) {
          await updateSchedule(data.editId, {
            email: data.email,
            recurrence: data.recurrence,
            next_scan_at: data.nextScanAt,
          });
        } else {
          await createSchedule(data.projectId, data.email, data.recurrence, data.nextScanAt);
        }
      } catch (err) {
        setToastMessage("Could not save the schedule. Please try again.");
        console.error("Schedule save failed:", err);
        return;
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

  const tourSteps: TourStep[] =
    tourPhase === "landing"
      ? landingTourSteps
      : tourPhase === "scanning"
      ? scanningTourSteps
      : tourPhase === "sidebar"
      ? sidebarTourSteps
      : tourPhase === "schedule"
      ? scheduleModalTourSteps
      : resultsTourSteps;

  // Pause tour when schedule modal opens mid-results tour, and resume when it closes
  useEffect(() => {
    if (!tourActive) return;
    if (showScheduleModal && tourPhase === "results") {
      setTourPhase("schedule");
      setTourStep(0);
    } else if (!showScheduleModal && tourPhase === "schedule") {
      setTourPhase("results");
      setTourStep(0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showScheduleModal]);

  // Auto-advance to scanning phase when a scan starts during landing tour
  useEffect(() => {
    if (!tourActive) return;
    if (view === "scanning" && tourPhase === "landing") {
      setTourPhase("scanning");
      setTourStep(0);
    } else if (view === "results" && tourPhase === "scanning") {
      setTourPhase("results");
      setTourStep(0);
    } else if (view === "landing" && tourPhase !== "landing" && tourPhase !== "schedule") {
      setTourPhase("landing");
      setTourStep(0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const handleTourNext = useCallback(() => {
    if (tourPhase === "landing" && tourStep >= landingTourSteps.length - 1) {
      if (view === "scanning") {
        setTourPhase("scanning");
        setTourStep(0);
      } else if (showSidebar) {
        setTourPhase("sidebar");
        setTourStep(0);
      } else {
        setTourActive(false);
        markTourCompleted();
      }
    } else if (tourPhase === "scanning" && tourStep >= scanningTourSteps.length - 1) {
      if (view === "results" && scanData) {
        setTourPhase("results");
        setTourStep(0);
      } else if (showSidebar) {
        setTourPhase("sidebar");
        setTourStep(0);
      } else {
        setTourActive(false);
        markTourCompleted();
      }
    } else if (tourPhase === "sidebar" && tourStep >= sidebarTourSteps.length - 1) {
      if (view === "results" && scanData) {
        setTourPhase("results");
        setTourStep(0);
      } else {
        setTourActive(false);
        markTourCompleted();
      }
    } else {
      setTourStep((prev) => prev + 1);
    }
  }, [tourPhase, tourStep, showSidebar, view, scanData]);

  const handleTourBack = useCallback(() => {
    if (tourStep === 0) {
      if (tourPhase === "schedule") {
        setTourPhase("results");
        setTourStep(resultsTourSteps.length - 1);
      } else if (tourPhase === "results") {
        if (showSidebar) {
          setTourPhase("sidebar");
          setTourStep(sidebarTourSteps.length - 1);
        } else {
          setTourPhase("scanning");
          setTourStep(scanningTourSteps.length - 1);
        }
      } else if (tourPhase === "sidebar") {
        if (view === "scanning") {
          setTourPhase("scanning");
          setTourStep(scanningTourSteps.length - 1);
        } else {
          setTourPhase("landing");
          setTourStep(landingTourSteps.length - 1);
        }
      } else if (tourPhase === "scanning") {
        setTourPhase("landing");
        setTourStep(landingTourSteps.length - 1);
      }
    } else {
      setTourStep((prev) => prev - 1);
    }
  }, [tourStep, tourPhase, showSidebar, view]);

  const handleTourSkip = useCallback(() => {
    setTourActive(false);
    markTourCompleted();
  }, []);

  const handleTourFinish = useCallback(() => {
    setTourActive(false);
    markTourCompleted();
    setToastMessage("Tour complete! You're ready to start scanning.");
  }, []);

  const handleReplayTour = useCallback(() => {
    resetTourCompletion();
    setTourStep(0);
    if (view === "scanning") {
      setTourPhase("scanning");
    } else if (view === "results" && scanData) {
      if (showScheduleModal) {
        setTourPhase("schedule");
      } else {
        setTourPhase("results");
      }
    } else if (showSidebar) {
      setTourPhase("sidebar");
    } else {
      setTourPhase("landing");
    }
    setTourActive(true);
  }, [view, scanData, showSidebar, showScheduleModal]);

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

      {/* Replay tour button — visible only when tour is not active and not on shared view */}
      {!tourActive && !isSharedView && (
        <button
          onClick={handleReplayTour}
          className="fixed bottom-4 right-4 z-30 flex items-center gap-2 px-3.5 py-2.5 bg-slate-900/90 hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-white text-xs font-medium rounded-xl shadow-lg backdrop-blur-sm transition-colors"
          aria-label="Replay onboarding tour"
          title="Replay onboarding tour"
        >
          <HelpCircle className="w-4 h-4 text-emerald-400" />
          <span className="hidden sm:inline">Tour</span>
        </button>
      )}

      {tourActive && (
        <TourOverlay
          steps={tourSteps}
          currentStep={tourStep}
          onNext={handleTourNext}
          onBack={handleTourBack}
          onSkip={handleTourSkip}
          onFinish={handleTourFinish}
        />
      )}
    </div>
  );
}

export default App;
