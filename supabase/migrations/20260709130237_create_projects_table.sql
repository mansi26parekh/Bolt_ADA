/*
# Create projects table

## Summary
Adds project management to ADA Scanner. A project represents a website domain that
has been scanned. Projects are created automatically from the domain of a scanned URL.

## New Tables

### projects
- `id` (uuid, primary key) — unique identifier
- `name` (text, not null) — extracted registered domain, e.g. "nike" from nike.com
- `domain` (text, unique, not null) — normalized registered domain used for deduplication
- `url` (text, not null) — original URL used when the project was first created
- `last_scan_id` (text, nullable) — ID of the most recent scan for this project
- `created_at` (timestamptz) — creation timestamp

## Security
- RLS enabled; open anon + authenticated read/write because this app has no sign-in screen.
- USING (true) is appropriate here — data is intentionally shared in this single-tenant app.

## Notes
1. `domain` has a UNIQUE constraint so duplicate-project detection is a simple DB lookup.
2. `last_scan_id` is text (not a foreign key) to avoid a cross-table constraint with the
   scans table managed by the ada-scan edge function.
3. All four CRUD policies are separate (no FOR ALL) per project conventions.
*/

CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  domain text NOT NULL,
  url text NOT NULL,
  last_scan_id text,
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS projects_domain_unique ON projects (domain);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_projects" ON projects;
CREATE POLICY "anon_select_projects" ON projects FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_projects" ON projects;
CREATE POLICY "anon_insert_projects" ON projects FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_projects" ON projects;
CREATE POLICY "anon_update_projects" ON projects FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_projects" ON projects;
CREATE POLICY "anon_delete_projects" ON projects FOR DELETE
  TO anon, authenticated USING (true);
