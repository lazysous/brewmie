-- Brewmie backend changes from the 2026-10-05 review.
--
-- Apply once in the Supabase SQL editor (project pdbfmmtwgsdkattjraya),
-- top to bottom. Every statement is idempotent. Nothing here deletes user
-- data; the one DELETE removes a single probe row the review inserted.
--
-- Sections:
--   1. shots: add the columns the app has been writing since the ShotEntry
--      shape changed. Personal shot sync has failed on every upsert because
--      PostgREST rejects unknown columns (PGRST204) before RLS is consulted.
--   2. effective_tier: stop the anonymous key reading every user's id, tier
--      and trial dates. Nothing in the app reads this view.
--   3. public_shots: sanity bounds so a malformed or hostile insert cannot
--      skew the community algorithm parameters.
--   4. global_shot_count: the union version (one count per physical shot).
--   5. Remove the review's probe row.
--
-- NOT included, owner decision (see the review report):
--   - revoking client write access to profiles.tier (entitlement model).
--   - wiring or removing the unused 7-day trial.

-- ---------------------------------------------------------------------------
-- 1. shots: the columns the client writes.
--    Existing columns are camelCase (inputTamp, actualVolume, tasteFlavor),
--    so the new ones match the client's ShotEntry field names exactly.
--    The legacy grind / dose / tamp / beans columns are left in place.
-- ---------------------------------------------------------------------------
alter table public.shots
  add column if not exists "inputGrind"    double precision,
  add column if not exists "inputDose"     double precision,
  add column if not exists "targetVolume"  double precision,
  add column if not exists "targetTime"    double precision,
  add column if not exists "grindAdjust"   double precision,
  add column if not exists "doseAdjust"    double precision,
  add column if not exists "volumeAdjust"  double precision,
  add column if not exists "timeAdjust"    double precision,
  add column if not exists "tampAdjust"    double precision,
  add column if not exists "crema"         text,
  add column if not exists "beanAge"       double precision,
  add column if not exists "roastLevel"    text,
  add column if not exists "temp"          double precision,
  add column if not exists "humidity"      double precision;

-- PostgREST caches the schema; this tells it to reload so the new columns
-- are accepted immediately rather than after the next restart.
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 2. effective_tier: not readable by the anonymous role, and when read by a
--    signed-in user only their own row (the view ran as its owner, which
--    bypassed the profiles RLS policy).
-- ---------------------------------------------------------------------------
revoke select on public.effective_tier from anon;
alter view public.effective_tier set (security_invoker = true);

-- ---------------------------------------------------------------------------
-- 3. public_shots: bounds. These match the app's own input ranges with
--    headroom; a real shot never violates them, a poisoning script does.
-- ---------------------------------------------------------------------------
alter table public.public_shots drop constraint if exists public_shots_sane_ranges;
alter table public.public_shots add constraint public_shots_sane_ranges check (
  (grind         is null or (grind         between 0   and 200)) and
  (dose          is null or (dose          between 0   and 60))  and
  (target_volume is null or (target_volume between 0   and 300)) and
  (actual_volume is null or (actual_volume between 0   and 300)) and
  (target_time   is null or (target_time   between 0   and 180)) and
  (actual_time   is null or (actual_time   between 0   and 180)) and
  (score         is null or (score         between 0   and 100)) and
  (temp          is null or (temp          between -40 and 60))  and
  (humidity      is null or (humidity      between 0   and 100)) and
  (tamp_value    is null or (tamp_value    between 0   and 100))
) not valid;
-- NOT VALID applies the rule to new rows only; existing rows are untouched.

-- ---------------------------------------------------------------------------
-- 4. global_shot_count: one count per physical shot. A signed-in user with
--    analytics on writes the same shot to both tables, linked by source_id.
-- ---------------------------------------------------------------------------
create or replace function public.global_shot_count()
returns bigint
language sql
security definer
set search_path = public
as $$
  select count(*)::bigint from (
    select id::text from public.shots
    union
    select coalesce(source_id, id::text) from public.public_shots
  ) all_shots;
$$;
grant execute on function public.global_shot_count() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The review's probe row (inserted 2026-10-05 to test anon write access).
-- ---------------------------------------------------------------------------
delete from public.public_shots where source_id = 'audit-probe-will-delete';
