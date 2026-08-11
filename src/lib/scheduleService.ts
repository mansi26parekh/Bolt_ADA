import { supabase } from "./supabase";
import type { ScheduledScan, Recurrence } from "./types";

export async function getActiveSchedules(): Promise<ScheduledScan[]> {
  const { data, error } = await supabase
    .from("scheduled_scans")
    .select("*")
    .eq("status", "active")
    .order("next_scan_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ScheduledScan[];
}

export async function createSchedule(
  projectId: string,
  email: string,
  recurrence: Recurrence,
  nextScanAt: string,
): Promise<ScheduledScan> {
  const { data, error } = await supabase
    .from("scheduled_scans")
    .insert({ project_id: projectId, email, recurrence, next_scan_at: nextScanAt })
    .select()
    .single();
  if (error) throw error;
  return data as ScheduledScan;
}

export async function updateSchedule(
  id: string,
  fields: Partial<Pick<ScheduledScan, "email" | "recurrence" | "next_scan_at">>,
): Promise<ScheduledScan> {
  const { data, error } = await supabase
    .from("scheduled_scans")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as ScheduledScan;
}

export async function cancelSchedule(id: string): Promise<void> {
  const { error } = await supabase
    .from("scheduled_scans")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}
