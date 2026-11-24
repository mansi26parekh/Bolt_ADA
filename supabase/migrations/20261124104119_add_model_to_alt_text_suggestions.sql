/*
# Track which AI model produced each alt-text suggestion

1. Modified Tables
- `alt_text_suggestions`
  - New column `model` (text, default '') - provider/model that generated the recommendation
    (e.g. "gemini:gemini-2.5-flash"). Useful once a fallback provider is added.

2. Security
- No change: table remains reachable only by the server function (service role).

3. Notes
1. Additive only; no existing data is modified.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'alt_text_suggestions' AND column_name = 'model'
  ) THEN
    ALTER TABLE alt_text_suggestions ADD COLUMN model text NOT NULL DEFAULT '';
  END IF;
END $$;