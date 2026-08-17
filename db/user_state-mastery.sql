-- Add "Your Eye" mastery to the account state so it follows you across devices (like streak already does).
-- Run once in the Supabase SQL editor. Safe/idempotent. Until this runs, api/sync.js silently no-ops the
-- mastery sync (streak/identity keep working); after it runs, mastery merges up/down on every login.
alter table public.user_state add column if not exists mastery jsonb;
