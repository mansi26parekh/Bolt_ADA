import { useState, useEffect, useCallback } from "react";
import type { ScanData, View } from "../lib/types";

const API_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ada-scan`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export function useScan() {
  const [view, setView] = useState<View>("landing");
  const [scanData, setScanData] = useState<ScanData | null>(null);
  const [scanId, setScanId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startScan = useCallback(async (url: string, maxDepth: number) => {
    setError(null);
    setScanData(null);

    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": ANON_KEY,
          "Authorization": `Bearer ${ANON_KEY}`,
        },
        body: JSON.stringify({ url, maxDepth }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to start scan");
      }

      const { scanId: id } = await response.json();
      setScanId(id);
      setView("scanning");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to start scan");
    }
  }, []);

  const fetchScanData = useCallback(async (id: string) => {
    try {
      const response = await fetch(`${API_URL}/${id}`, {
        headers: {
          "Content-Type": "application/json",
          "apikey": ANON_KEY,
          "Authorization": `Bearer ${ANON_KEY}`,
        },
      });

      if (!response.ok) throw new Error("Failed to fetch scan data");

      const data: ScanData = await response.json();
      setScanData(data);

      if (data.scan.status === "completed" || data.scan.status === "failed") {
        setView("results");
      }
    } catch {
      // Silently retry on next poll
    }
  }, []);

  // Poll for scan updates
  useEffect(() => {
    if (!scanId || view !== "scanning") return;

    fetchScanData(scanId);
    const interval = setInterval(() => {
      fetchScanData(scanId);
    }, 2000);

    return () => clearInterval(interval);
  }, [scanId, view, fetchScanData]);

  const goToResults = useCallback((id: string) => {
    setScanId(id);
    fetchScanData(id);
  }, [fetchScanData]);

  const resetScan = useCallback(() => {
    setView("landing");
    setScanData(null);
    setScanId(null);
    setError(null);
  }, []);

  return {
    view,
    scanData,
    scanId,
    error,
    startScan,
    goToResults,
    resetScan,
    setView,
  };
}
