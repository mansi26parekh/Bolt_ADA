import { useScan } from "./hooks/useScan";
import { LandingPage } from "./components/LandingPage";
import { ScanningView } from "./components/ScanningView";
import { ResultsDashboard } from "./components/ResultsDashboard";

function App() {
  const { view, scanData, scanId, error, startScan, resetScan } = useScan();

  if (view === "scanning" && scanId) {
    return <ScanningView scanData={scanData} scanId={scanId} />;
  }

  if (view === "results" && scanData) {
    return <ResultsDashboard scanData={scanData} onReset={resetScan} />;
  }

  return <LandingPage onStartScan={startScan} error={error} />;
}

export default App;
