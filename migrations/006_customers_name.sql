-- Add name column so Bella can persist the customer's first name.
-- Idempotent: safe to re-run.

alter table customers add column if not exists name text;
