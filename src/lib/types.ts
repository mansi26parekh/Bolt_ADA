export interface Scan {
  id: string;
  url: string;
  status: "pending" | "running" | "completed" | "failed";
  total_pages: number;
  pages_scanned: number;
  max_depth: number;
  score: number | null;
  total_violations: number;
  total_passes: number;
  created_at: string;
  completed_at: string | null;
}

export interface ScanPage {
  id: string;
  scan_id: string;
  url: string;
  depth: number;
  status: "pending" | "running" | "completed" | "failed";
  score: number | null;
  violation_count: number;
  pass_count: number;
  title: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface ScanResult {
  id: string;
  page_id: string;
  scan_id: string;
  impact: "critical" | "serious" | "moderate" | "minor" | string;
  category: string;
  rule_id: string;
  title: string;
  description: string;
  help_url: string | null;
  element: string | null;
  selector: string | null;
  created_at: string;
}

export interface ScanData {
  scan: Scan;
  pages: ScanPage[];
  results: ScanResult[];
}

export type View = "landing" | "scanning" | "results";
