/*
  # ADA Compliance Scanner - Database Schema

  1. New Tables
    - `scans`
      - `id` (uuid, primary key) - Unique scan identifier
      - `url` (text) - The root URL that was scanned
      - `status` (text) - Scan status: pending, running, completed, failed
      - `total_pages` (integer) - Total pages discovered during crawl
      - `pages_scanned` (integer) - Number of pages actually scanned
      - `max_depth` (integer) - Maximum crawl depth used
      - `score` (integer) - Overall accessibility score (0-100)
      - `total_violations` (integer) - Total violations found
      - `total_passes` (integer) - Total passes found
      - `created_at` (timestamptz) - When scan was initiated
      - `completed_at` (timestamptz) - When scan finished

    - `scan_pages`
      - `id` (uuid, primary key) - Unique page identifier
      - `scan_id` (uuid, FK to scans) - Parent scan
      - `url` (text) - Page URL
      - `depth` (integer) - Crawl depth from root
      - `status` (text) - Page scan status: pending, running, completed, failed
      - `score` (integer) - Page accessibility score (0-100)
      - `violation_count` (integer) - Number of violations on this page
      - `pass_count` (integer) - Number of passes on this page
      - `title` (text) - Page title
      - `created_at` (timestamptz) - When page scan started
      - `completed_at` (timestamptz) - When page scan finished

    - `scan_results`
      - `id` (uuid, primary key) - Unique result identifier
      - `page_id` (uuid, FK to scan_pages) - Parent page
      - `scan_id` (uuid, FK to scans) - Parent scan (for easier querying)
      - `impact` (text) - Violation impact: critical, serious, moderate, minor
      - `category` (text) - WCAG category
      - `rule_id` (text) - axe-core rule ID
      - `description` (text) - Description of the violation
      - `help_url` (text) - Link to remediation guidance
      - `element` (text) - HTML element that failed
      - `selector` (text) - CSS selector for the element
      - `created_at` (timestamptz) - When result was recorded

  2. Security
    - Enable RLS on all tables
    - Allow public read access (scans are shareable via URL)
    - Allow anon insert for new scans
    - Restrict update/delete to service role only

  3. Indexes
    - Index on scans.status for filtering
    - Index on scan_pages.scan_id for join performance
    - Index on scan_results.scan_id for join performance
    - Index on scan_results.page_id for join performance
    - Index on scan_results.impact for filtering
*/

-- Create scans table
CREATE TABLE IF NOT EXISTS scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  total_pages integer NOT NULL DEFAULT 0,
  pages_scanned integer NOT NULL DEFAULT 0,
  max_depth integer NOT NULL DEFAULT 2,
  score integer,
  total_violations integer NOT NULL DEFAULT 0,
  total_passes integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

-- Create scan_pages table
CREATE TABLE IF NOT EXISTS scan_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id uuid NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  url text NOT NULL,
  depth integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  score integer,
  violation_count integer NOT NULL DEFAULT 0,
  pass_count integer NOT NULL DEFAULT 0,
  title text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

-- Create scan_results table
CREATE TABLE IF NOT EXISTS scan_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id uuid NOT NULL REFERENCES scan_pages(id) ON DELETE CASCADE,
  scan_id uuid NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  impact text NOT NULL,
  category text NOT NULL,
  rule_id text NOT NULL,
  description text NOT NULL,
  help_url text,
  element text,
  selector text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE scan_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE scan_results ENABLE ROW LEVEL SECURITY;

-- Scans policies
CREATE POLICY "Anyone can view scans"
  ON scans FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Anyone can create scans"
  ON scans FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Service role can update scans"
  ON scans FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Scan pages policies
CREATE POLICY "Anyone can view scan pages"
  ON scan_pages FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Anyone can create scan pages"
  ON scan_pages FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Service role can update scan pages"
  ON scan_pages FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Scan results policies
CREATE POLICY "Anyone can view scan results"
  ON scan_results FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Anyone can create scan results"
  ON scan_results FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_scans_status ON scans(status);
CREATE INDEX IF NOT EXISTS idx_scan_pages_scan_id ON scan_pages(scan_id);
CREATE INDEX IF NOT EXISTS idx_scan_results_scan_id ON scan_results(scan_id);
CREATE INDEX IF NOT EXISTS idx_scan_results_page_id ON scan_results(page_id);
CREATE INDEX IF NOT EXISTS idx_scan_results_impact ON scan_results(impact);
