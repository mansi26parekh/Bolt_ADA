/*
# Saved AI alt-text suggestions

1. New Tables
- `alt_text_suggestions`: one AI-generated alt-text recommendation per "Missing image alt text" issue,
  saved so the card and the Fix hint always show the exact same recommendation.
  - `result_id` (uuid, primary key, references scan_results, removed with it)
  - `image_url` (text) - resolved image address that was analysed
  - `alt_text` (text) - recommended alt text ('' when decorative)
  - `decorative` (boolean) - true when the image should use alt=""
  - `created_at` (timestamptz)

2. Security
- RLS enabled with no anon/authenticated policies and no grants to those roles:
  the table is only read and written by the `suggest-alt-text` server function (service role).

3. Notes
1. Existing tables and data are not changed.
*/

CREATE TABLE IF NOT EXISTS alt_text_suggestions (
  result_id uuid PRIMARY KEY REFERENCES scan_results(id) ON DELETE CASCADE,
  image_url text NOT NULL DEFAULT '',
  alt_text text NOT NULL DEFAULT '',
  decorative boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE alt_text_suggestions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON alt_text_suggestions FROM anon, authenticated;
GRANT SELECT, INSERT ON alt_text_suggestions TO service_role;