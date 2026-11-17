/*
# Add specific-date scheduled scans

## Summary
Replaces the yearly recurrence option with a one-time specific-date option.
A scheduled scan can now run once on its selected date and then be marked
cancelled automatically after the report is processed.

## Modified Tables

### scheduled_scans
- `recurrence` — now accepts `monthly`, `every_3_months`, or `once`.
- Existing `next_scan_at`, email, project, and status data are preserved.

## Security
- Existing row-level security remains enabled.
- Existing anon and authenticated CRUD policies are unchanged.

## Important Notes
1. Existing schedules using monthly or every-three-months recurrence continue to work.
2. No existing rows are deleted or rewritten.
3. One-time schedules are cancelled after their scan completes so they cannot run repeatedly.
*/

ALTER TABLE scheduled_scans
  DROP CONSTRAINT IF EXISTS scheduled_scans_recurrence_check;

ALTER TABLE scheduled_scans
  ADD CONSTRAINT scheduled_scans_recurrence_check
  CHECK (recurrence IN ('monthly', 'every_3_months', 'once'));
