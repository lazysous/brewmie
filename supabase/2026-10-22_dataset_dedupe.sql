-- brewmie-60 (owner decision D82): dedupe public_shots by source_id, trim outliers, then a unique index.
-- Paste into the Supabase SQL editor (project pdbfmmtwgsdkattjraya). Run PART A first and read it.
-- Then run PART B (one transaction). Then run PART C on its own (CONCURRENTLY cannot run in a transaction).
--
-- BEFORE numbers (exported through the anon REST API on 2026-10-21, 399 rows, created_at 2026-05-11 to 2026-10-19):
--   rows                              399
--   rows with a source_id              72   (distinct 72, duplicate groups 0, so a source_id dedupe alone deletes NOTHING)
--   rows with source_id NULL          327   (all created up to 2026-09-30, before the client sent source_id; the old
--                                            client re-posted the newest shot on every launch, so these are mostly copies)
--   NULL rows identical on every shot value: 66 distinct shots, 261 surplus copies (optional Part B2)
--   outliers (range, justification at the Part A query):
--     actual_time  < 10 s : 74 rows (0.1 s to 9.9 s, a timer stopped at once)    actual_time > 90 s : 1 row (233 s)
--     actual_volume < 10 g: 1 row (8)
--     dose 0, target_volume 0, target_time 0, grind 0, tamp_value 0, score 0, temp 0, humidity 0 rows
--   distinct rows hit by any outlier   75 (56 NULL-source, 19 with a source_id)
--   B1 (source_id dedupe + outliers) deletes 75 of 399 = 18.8%, leaving 324
--   B1 + B2 (also dedupe NULL-source copies) deletes 302 of 399 = 75.7%, leaving 97
--   Learning gate (get_algo_params n counts actual_time > 0; the app learns once n >= 30, BrewScreen MIN_SHOTS_TO_LEARN):
--     n 399 -> 324 (B1) -> 97 (B1+B2). Still above 30 either way. time_window stays clamped at 8 (stddev of
--     actual_time - target_time was 16.4 s, 6.9 s after the trim, 10.1 s after B1+B2; 1.5 x stddev is above 8 in all cases).
--   global_shot_count() counts coalesce(source_id, id::text) per row of public_shots: the 327 NULL-source rows each count
--   as one shot today. After B1 it drops by the 75 rows deleted ; after B1+B2 by 302. A signed-in user's shot still counts once via shots.id. Expected, not a bug.
--
-- HOW THE APP READS public_shots (so nothing here breaks a reader):
--   * The client never SELECTs the table (anon can insert and read; the app only inserts: upsertPublicShot in src/lib/supabase.ts).
--   * get_algo_params() (SECURITY DEFINER): reads actual_time, target_time, humidity, temp, bean_age_bucket; filters
--     actual_time IS NOT NULL AND actual_time > 0 (and target_time NOT NULL for the deltas). Every conditional average needs >= 5 rows.
--   * global_shot_count() reads source_id and id (union with shots.id).
--   * the OTA worker keepalive does one anonymous read of `id` (limit 1). Keep at least one row.
--   Deleting rows only shrinks these aggregates. No column, policy, trigger or function is touched.
--
-- Can the client post one source_id twice? source_id = ShotEntry.id (the local shot UUID). A shot posts once, when it first
-- gets a tasteFlavor, only if recorded this session, tracked in a per-session Set (useBrewmie.ts). An edit never re-posts and
-- a hydrate from the server never posts. The data confirms it: 0 duplicated source_ids among the 72 since the fix. A repeat is
-- not expected: after a relaunch the ids present at mount are history and never post.
-- So a plain unique index is enough: a rare repeat gets a 23505 error, which the client already swallows (console.warn plus
-- a sync_failed analytics event). NO client change is shipped with this item, deliberately: an upsert needs
-- `.upsert(payload, { onConflict: 'source_id', ignoreDuplicates: true })` (ON CONFLICT DO NOTHING, needs only INSERT, never grant
-- anon UPDATE), and that call fails EVERY post (42P10) on any device until Part C exists, so it must follow Part C by an OTA.
-- Optional follow-up after Part C: make that one-line change in upsertPublicShot and update tests/characterisation.test.ts.
-- NOTE the index below is NOT partial: a partial index cannot be inferred by ON CONFLICT (source_id). Postgres treats NULLs as
-- distinct in a unique index, so the NULL-source legacy rows are still allowed.

-- =========================== PART A: dry run (read only) ===========================
-- Ranges and why: dose 5-30 g (single/double basket); volumes 10-120 g (ristretto to lungo, 8 g is a stopped scale);
-- times 10-90 s (under 10 s is a timer stopped at once, over 90 s is not espresso); grind 0-100 (dial positions, app max seen 32);
-- tamp_value 1-100 (percent of force, 0 = unset); score 0-100; temp 5-40 C (room ambient); humidity 5-100 %.

with dup as (
  select source_id, count(*) as copies, min(created_at) as first_seen, max(created_at) as last_seen
  from public.public_shots where source_id is not null group by source_id having count(*) > 1
)
select 'duplicate source_id groups' as what, count(*) as n from dup
union all select 'surplus rows in those groups', coalesce(sum(copies - 1), 0) from dup
union all select 'rows with NULL source_id', count(*) from public.public_shots where source_id is null
union all select 'total rows', count(*) from public.public_shots
union all select 'outlier dose',          count(*) from public.public_shots where dose          is not null and (dose          < 5  or dose          > 30)
union all select 'outlier actual_volume', count(*) from public.public_shots where actual_volume is not null and (actual_volume < 10 or actual_volume > 120)
union all select 'outlier target_volume', count(*) from public.public_shots where target_volume is not null and (target_volume < 10 or target_volume > 120)
union all select 'outlier actual_time',   count(*) from public.public_shots where actual_time   is not null and (actual_time   < 10 or actual_time   > 90)
union all select 'outlier target_time',   count(*) from public.public_shots where target_time   is not null and (target_time   < 10 or target_time   > 90)
union all select 'outlier grind',         count(*) from public.public_shots where grind         is not null and (grind         < 0  or grind         > 100)
union all select 'outlier tamp_value',    count(*) from public.public_shots where tamp_value    is not null and (tamp_value    < 1  or tamp_value    > 100)
union all select 'outlier score',         count(*) from public.public_shots where score         is not null and (score         < 0  or score         > 100)
union all select 'outlier temp',          count(*) from public.public_shots where temp          is not null and (temp          < 5  or temp          > 40)
union all select 'outlier humidity',      count(*) from public.public_shots where humidity      is not null and (humidity      < 5  or humidity      > 100)
union all select 'NULL-source surplus copies (Part B2)', count(*) from (
  select row_number() over (
    partition by grind, dose, target_volume, target_time, actual_volume, actual_time, score, taste_flavor, taste_strength,
                 bean_age_bucket, roast_level, temp, humidity, machine_brand, grinder_type, tamp_type, tamp_value
    order by created_at desc, id desc) as rn
  from public.public_shots where source_id is null) s where rn > 1;

-- The duplicate groups themselves (empty on 2026-10-21):
select source_id, count(*) as copies, min(created_at) as first_seen, max(created_at) as last_seen
from public.public_shots where source_id is not null group by source_id having count(*) > 1
order by copies desc;

-- =========================== PART B: the cleanup (one transaction) ===========================
begin;

-- B1a. Keep the NEWEST row per source_id (key: created_at, then id). The newest copy carries the latest values.
delete from public.public_shots where id in (
  select id from (
    select id, row_number() over (partition by source_id order by created_at desc, id desc) as rn
    from public.public_shots where source_id is not null
  ) d where rn > 1
);

-- B1b. Trim outliers (NULL values are kept: a missing value is not an outlier).
delete from public.public_shots where
     (dose          is not null and (dose          < 5  or dose          > 30))
  or (actual_volume is not null and (actual_volume < 10 or actual_volume > 120))
  or (target_volume is not null and (target_volume < 10 or target_volume > 120))
  or (actual_time   is not null and (actual_time   < 10 or actual_time   > 90))
  or (target_time   is not null and (target_time   < 10 or target_time   > 90))
  or (grind         is not null and (grind         < 0  or grind         > 100))
  or (tamp_value    is not null and (tamp_value    < 1  or tamp_value    > 100))
  or (score         is not null and (score         < 0  or score         > 100))
  or (temp          is not null and (temp          < 5  or temp          > 40))
  or (humidity      is not null and (humidity      < 5  or humidity      > 100));

-- B2 (OPTIONAL, NOT in D82's wording, default OFF): collapse the legacy NULL-source copies that are identical on every shot
-- value, keeping the newest of each group. Uncomment to apply (deletes about 261 more rows, 66 shots remain from that era).
-- delete from public.public_shots where id in (
--   select id from (
--     select id, row_number() over (
--       partition by grind, dose, target_volume, target_time, actual_volume, actual_time, score, taste_flavor, taste_strength,
--                    bean_age_bucket, roast_level, temp, humidity, machine_brand, grinder_type, tamp_type, tamp_value
--       order by created_at desc, id desc) as rn
--     from public.public_shots where source_id is null
--   ) d where rn > 1
-- );

-- Check before committing: rows left, and the gate count (need >= 30; the app learns above that).
select count(*) as rows_left, count(*) filter (where actual_time > 0) as gate_n from public.public_shots;

commit;   -- if the numbers look wrong, type `rollback;` instead of running this line.

-- =========================== PART C: unique index (run on its own, outside any transaction) ===========================
create unique index concurrently if not exists public_shots_source_id_key on public.public_shots (source_id);
-- (Deviation from the brief: no `where source_id is not null`. NULLs are already distinct in a unique index, and a partial
-- index would break a later `on conflict (source_id)` upsert.)

-- OPTIONAL Part D, after C: tighten the live CHECK so outliers stop arriving (the current one allows times to 180 s, dose to 60).
-- Rejected posts only warn in the client. NOT VALID so old rows are not re-checked.
-- alter table public.public_shots drop constraint if exists public_shots_sane_ranges;
-- alter table public.public_shots add constraint public_shots_sane_ranges check (
--   (grind is null or grind between 0 and 100) and (dose is null or dose between 5 and 30) and
--   (target_volume is null or target_volume between 10 and 120) and (actual_volume is null or actual_volume between 10 and 120) and
--   (target_time is null or target_time between 10 and 90) and (actual_time is null or actual_time between 10 and 90) and
--   (score is null or score between 0 and 100) and (temp is null or temp between 5 and 40) and
--   (humidity is null or humidity between 5 and 100) and (tamp_value is null or tamp_value between 1 and 100)
-- ) not valid;
