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
--   2. Remove the unused 7-day trial (view, function, column).
--   3. public_shots: sanity bounds so a malformed or hostile insert cannot
--      skew the community algorithm parameters.
--   4. global_shot_count: the union version (one count per physical shot).
--   5. Remove the review's probe row.
--
--   6. profiles.tier no longer client-writable; anon loses profiles/shots.
--   7. OPTIONAL deduplication of public_shots (commented out).

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
-- 2. The 7-day trial is removed (owner decision 2026-10-05). It was never
--    wired in the client; all 32 profiles had trial_started_at = null when
--    this ran. The effective_tier view was also readable by the anon key and
--    listed every user's id and tier.
-- ---------------------------------------------------------------------------
drop view if exists public.effective_tier;
drop function if exists public.start_trial();
alter table public.profiles drop column if exists trial_started_at;

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

-- ---------------------------------------------------------------------------
-- 6. Entitlement: profiles.tier is no longer client-writable (owner decision
--    2026-10-05). Premium ownership lives in the App Store / Play account and
--    Restore Purchases carries it between devices; the 4 profiles that already
--    hold tier = 'premium' keep it. The client stops writing tier in OTA 1.1.1.
--    Column-level privileges: table-level INSERT/UPDATE are withdrawn from the
--    authenticated role and granted back on every column except tier.
--    The anon role gets no access to profiles or shots at all (the app never
--    reads either before sign-in).
-- ---------------------------------------------------------------------------
revoke select, insert, update, delete on public.profiles from anon;
revoke select, insert, update, delete on public.shots from anon;
revoke insert, update on public.profiles from authenticated;
grant insert (id, display_name, units, machine, grinder, tamp, beans, updated_at),
      update (id, display_name, units, machine, grinder, tamp, beans, updated_at)
  on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 7. OPTIONAL, owner decision: deduplicate public_shots.
--    Until OTA 1.0.10 the client re-posted the newest shot on every launch
--    and every delete. On 2026-10-05 the table held 393 rows for 123 distinct
--    shots (one shot appeared 144 times), which weights get_algo_params toward
--    whoever launched the app most. This keeps the EARLIEST row of each group
--    of rows that are identical on every shot value and deletes the rest.
--    Run the SELECT first to see the count; uncomment the DELETE to apply.
-- ---------------------------------------------------------------------------
-- select count(*) as surplus_rows from (
--   select id, row_number() over (
--     partition by grind, dose, target_volume, target_time, actual_volume,
--                  actual_time, score, taste_flavor, taste_strength, bean_age_bucket,
--                  roast_level, temp, humidity, machine_brand, grinder_type, tamp_type
--     order by created_at asc, id asc) as rn
--   from public.public_shots
-- ) d where rn > 1;
--
-- delete from public.public_shots where id in (
--   select id from (
--     select id, row_number() over (
--       partition by grind, dose, target_volume, target_time, actual_volume,
--                    actual_time, score, taste_flavor, taste_strength, bean_age_bucket,
--                    roast_level, temp, humidity, machine_brand, grinder_type, tamp_type
--       order by created_at asc, id asc) as rn
--     from public.public_shots
--   ) d where rn > 1
-- );
