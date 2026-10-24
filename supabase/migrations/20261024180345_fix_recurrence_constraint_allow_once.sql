/*
# Fix recurrence constraint to allow 'once'

## Summary
The scheduled_scans table has a CHECK constraint on recurrence that only
allows 'monthly', 'every_3_months', 'yearly'. The frontend sends 'once' for
the "Specific Date" option, so every schedule created with that option was
rejected by the database silently. This replaces the constraint to match the
values the app actually uses.

## Changes
- Drops the old recurrence CHECK constraint.
- Adds a new CHECK constraint allowing 'monthly', 'every_3_months', 'once'.

## Security
- No RLS changes.
*/
ALTER TABLE scheduled_scans DROP CONSTRAINT IF EXISTS scheduled_scans_recurrence_check;
ALTER TABLE scheduled_scans DROP CONSTRAINT IF EXISTS scheduled_scans_recurrence_check1;

ALTER TABLE scheduled_scans ADD CONSTRAINT scheduled_scans_recurrence_check
  CHECK (recurrence IN ('monthly', 'every_3_months', 'once'));
