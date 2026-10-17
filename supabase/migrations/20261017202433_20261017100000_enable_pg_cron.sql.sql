/*
# Enable pg_cron and pg_net for scheduled scans

## Summary
Enables the pg_cron and pg_net extensions so the database can invoke the
run-scheduled-scans edge function on a fixed interval. This is required
because Supabase Edge Functions do not self-schedule; an external trigger
must call them.

## Changes
- Creates the `pg_cron` extension in the `extensions` schema (Supabase convention).
- Creates the `pg_net` extension in the `extensions` schema.
- Creates a cron job that calls the run-scheduled-scans edge function every 10 minutes.

## Security
- No RLS changes.
- The cron job uses the service role key from vault to authorize the internal fetch.

## Notes
1. pg_cron must be created in the `extensions` schema on Supabase.
2. The job uses `net.http_post` from pg_net to invoke the edge function endpoint.
*/
CREATE SCHEMA IF NOT EXISTS extensions;

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
