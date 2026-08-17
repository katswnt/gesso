-- Account-link the glossary (terms learned) + seen-works set so they follow you across devices, like
-- streak/mastery already do. Run once in the Supabase SQL editor. Safe/idempotent. Until this runs,
-- api/sync.js silently no-ops the glossary/seen sync (streak/mastery/saves keep working).
alter table public.user_state add column if not exists glossary jsonb;
alter table public.user_state add column if not exists seen jsonb;
