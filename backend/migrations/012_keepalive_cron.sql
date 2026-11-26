-- Supabase free-plan keep-alive: a free project is paused after a week without database
-- activity. The API and the ingestor already write a daily heartbeat (startHeartbeat), but only
-- while a server runs; this job runs inside the database itself, so the project stays active
-- even when every server is stopped. Once a day it records 'heartbeat:pg_cron' in job_state.
--
-- Skipped for test schemas, and when pg_cron cannot be enabled (e.g. a plain local Postgres):
-- then only the servers' heartbeat runs. Re-running is safe (cron.schedule replaces a job of the
-- same name).
DO $$
DECLARE
  target text := current_schema();
BEGIN
  IF target LIKE '%\_test' THEN
    RETURN;
  END IF;
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog; -- as Supabase's docs enable it
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron is not available (%): no in-database keep-alive job', SQLERRM;
    RETURN;
  END;
  PERFORM cron.schedule(
    'keepalive_' || target,
    '17 3 * * *', -- daily at 03:17 UTC
    format(
      $cmd$INSERT INTO %I.job_state (name, value) VALUES ('heartbeat:pg_cron', now())
           ON CONFLICT (name) DO UPDATE SET value = now()$cmd$,
      target));
END $$;
