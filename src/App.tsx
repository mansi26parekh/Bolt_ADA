import { useState, useEffect, useCallback } from "react";
import { useScan } from "./hooks/useScan";
import { LandingPage } from "./components/LandingPage";
import { ScanningView } from "./components/ScanningView";
import { ResultsDashboard } from "./components/ResultsDashboard";
import { Sidebar } from "./components/Sidebar";
import { Toast } from "./components/Toast";
import { ConfirmDialog } from "./components/ConfirmDialog";
import {
  ensureProject,
  getAllProjects,
  updateLastScan,
  deleteProject,
} from "./lib/projectService";
import type { Project, ScanData } from "./lib/types";

const API_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ada-scan`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

function App() {
  const { view, scanData, scanId, error, startScan, goToResults, resetScan } = useScan();

  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [landingInitialUrl, setLandingInitialUrl] = useState<string>("");
  const [pendingDeleteProject, setPendingDeleteProject] = useState<Project | null>(null);
  const [sharedScanData, setSharedScanData] = useState<ScanData | null>(null);

  const sharedScanId = new URLSearchParams(window.location.search).get("scan");
  const isSharedView = Boolean(sharedScanId);

  // Load projects on mount
  useEffect(() => {
    getAllProjects()
      .then(setProjects)
      .catch(() => {});
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

  const showSidebar = view !== "landing" && !isSharedView;

  return (
    <div className="flex h-screen overflow-hidden bg-slate-950">
      {showSidebar && (
        <Sidebar
          projects={projects}
          activeProjectId={activeProjectId}
          onSelectProject={handleSelectProject}
          onDeleteProject={handleDeleteProject}
          onNewScan={handleNewScan}
        />
      )}

      <div className="flex-1 overflow-auto">
        {isSharedView ? (
          sharedScanData ? (
            <ResultsDashboard scanData={sharedScanData} onReset={() => {}} />
          ) : (
            <div className="flex items-center justify-center h-full text-slate-400">
              <p className="text-sm">Loading shared report…</p>
            </div>
          )
        ) : view === "scanning" && scanId ? (
          <ScanningView scanData={scanData} scanId={scanId} />
        ) : view === "results" && scanData ? (
          <ResultsDashboard scanData={scanData} onReset={handleNewScan} />
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
    </div>
  );
}

export default App;
