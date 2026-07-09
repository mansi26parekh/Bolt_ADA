import { supabase } from "./supabase";
import type { Project } from "./types";

const COMPOUND_TLDS = new Set([
  "co.uk", "com.au", "co.nz", "co.in", "com.br", "co.jp", "org.uk",
  "net.au", "org.au", "co.za", "com.mx", "com.ar", "com.co",
]);

export function extractDomain(rawUrl: string): string {
  try {
    let url = rawUrl.trim();
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    const parts = hostname.split(".");
    if (parts.length < 2) return hostname;
    const lastTwo = parts.slice(-2).join(".");
    if (COMPOUND_TLDS.has(lastTwo) && parts.length >= 3) {
      return parts[parts.length - 3];
    }
    return parts[parts.length - 2];
  } catch {
    return rawUrl;
  }
}

export interface EnsureProjectResult {
  project: Project;
  alreadyExisted: boolean;
}

export async function ensureProject(url: string): Promise<EnsureProjectResult> {
  const domain = extractDomain(url);

  const { data: existing, error: findError } = await supabase
    .from("projects")
    .select("*")
    .eq("domain", domain)
    .maybeSingle();

  if (findError) throw findError;

  if (existing) {
    return { project: existing as Project, alreadyExisted: true };
  }

  const { data: created, error: insertError } = await supabase
    .from("projects")
    .insert({ name: domain, domain, url })
    .select()
    .single();

  if (insertError) throw insertError;
  return { project: created as Project, alreadyExisted: false };
}

export async function getAllProjects(): Promise<Project[]> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .order("name", { ascending: true });

  if (error) throw error;
  return (data ?? []) as Project[];
}

export async function updateLastScan(projectId: string, scanId: string): Promise<void> {
  await supabase
    .from("projects")
    .update({ last_scan_id: scanId })
    .eq("id", projectId);
}
