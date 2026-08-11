/*
# Create scheduled_scans table

## Summary
Adds support for scheduled recurring accessibility scans. Users can schedule
a scan for any existing project with a chosen recurrence, start date/time,
and notification email address.

## New Tables

### scheduled_scans
- `id` (uuid, primary key) — unique identifier
- `project_id` (uuid, not null, FK → projects.id CASCADE) — linked project
- `email` (text, not null) — email address to receive completed scan reports
- `recurrence` (text, not null) — one of 'monthly', 'every_3_months', 'yearly'
- `next_scan_at` (timestamptz, not null) — when the next scan will run
- `last_scan_id` (text) — ID of the most recent scheduled scan result
- `status` (text, not null, default 'active') — 'active' or 'cancelled'
- `created_at` (timestamptz) — creation timestamp
- `updated_at` (timestamptz) — last modification timestamp

## Security
- RLS enabled; open anon + authenticated CRUD because this is a single-tenant app with no sign-in.

## Notes
1. One schedule per project enforced by a unique partial index on project_id
   where status = 'active'.
2. Deleting a project cascades to its scheduled_scans rows.
3. `recurrence` is constrained via CHECK to prevent invalid values.
*/

CREATE TABLE IF NOT EXISTS scheduled_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  email text NOT NULL,
  recurrence text NOT NULL CHECK (recurrence IN ('monthly', 'every_3_months', 'yearly')),
  next_scan_at timestamptz NOT NULL,
  last_scan_id text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS scheduled_scans_active_project
  ON scheduled_scans (project_id) WHERE status = 'active';

ALTER TABLE scheduled_scans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_scheduled_scans" ON scheduled_scans;
CREATE POLICY "anon_select_scheduled_scans" ON scheduled_scans FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_scheduled_scans" ON scheduled_scans;
CREATE POLICY "anon_insert_scheduled_scans" ON scheduled_scans FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_scheduled_scans" ON scheduled_scans;
CREATE POLICY "anon_update_scheduled_scans" ON scheduled_scans FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_scheduled_scans" ON scheduled_scans;
CREATE POLICY "anon_delete_scheduled_scans" ON scheduled_scans FOR DELETE
  TO anon, authenticated USING (true);
