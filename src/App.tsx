import { useState, useEffect, useCallback } from "react";
import { useScan } from "./hooks/useScan";
import { LandingPage } from "./components/LandingPage";
import { ScanningView } from "./components/ScanningView";
import { ResultsDashboard } from "./components/ResultsDashboard";
import { Sidebar } from "./components/Sidebar";
import { Toast } from "./components/Toast";
import {
  ensureProject,
  getAllProjects,
  updateLastScan,
} from "./lib/projectService";
import type { Project } from "./lib/types";

function App() {
  const { view, scanData, scanId, error, startScan, goToResults, resetScan } = useScan();

  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [landingInitialUrl, setLandingInitialUrl] = useState<string>("");

  // Load projects on mount
  useEffect(() => {
    getAllProjects()
      .then(setProjects)
      .catch(() => {});
  }, []);

  // When a scan starts (scanId appears), record it on the active project
  useEffect(() => {
    if (!scanId || !activeProjectId) return;
    updateLastScan(activeProjectId, scanId)
      .then(() =>
        getAllProjects().then((list) => {
          setProjects(list);
          // Keep last_scan_id in sync on the active project
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
        setActiveProjectId(project.id);

        if (alreadyExisted) {
          setToastMessage("Project already exists. Opening existing project.");
          // Refresh projects list to get latest state
          getAllProjects().then(setProjects).catch(() => {});
        } else {
          setProjects((prev) =>
            [...prev, project].sort((a, b) => a.name.localeCompare(b.name))
          );
        }
      } catch {
        // Project creation failure is non-blocking — scan still proceeds
      }

      startScan(url, maxDepth);
    },
    [startScan]
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

  return (
    <div className="flex h-screen overflow-hidden bg-slate-950">
      <Sidebar
        projects={projects}
        activeProjectId={activeProjectId}
        onSelectProject={handleSelectProject}
        onNewScan={handleNewScan}
      />

      <div className="flex-1 overflow-auto">
        {view === "scanning" && scanId ? (
          <ScanningView scanData={scanData} scanId={scanId} />
        ) : view === "results" && scanData ? (
          <ResultsDashboard scanData={scanData} onReset={handleNewScan} />
        ) : (
          <LandingPage
            onStartScan={handleStartScan}
            error={error}
            initialUrl={landingInitialUrl}
          />
        )}
      </div>

      {toastMessage && (
        <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} />
      )}
    </div>
  );
}

export default App;
