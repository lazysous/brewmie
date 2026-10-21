-- Brewmie: ONE paste for the Supabase SQL editor (2026-10-22). Select all, paste, press Run.
-- All or nothing: if any statement fails, nothing changes. The last query prints what changed.
-- Combines supabase/2026-10-22_audit_policies.sql (brewmie-02/-22/-58) and Parts B1 + C of
-- supabase/2026-10-22_dataset_dedupe.sql (brewmie-60, owner decision D82). The optional Part B2
-- (removing most legacy rows) is NOT included.
begin;

-- 1. Signed-in users can delete their own synced shots (deletes now reach the server).
drop policy if exists "owners delete their own shots" on public.shots;
create policy "owners delete their own shots"
  on public.shots for delete to authenticated
  using (auth.uid() = user_id);

-- 2. Community dataset: bounded text and a daily insert cap.
alter table public.public_shots drop constraint if exists public_shots_text_bounds;
alter table public.public_shots
  add constraint public_shots_text_bounds check (
    coalesce(length(source_id), 0) <= 64
    and coalesce(length(machine_brand), 0) <= 64
    and coalesce(length(grinder_type), 0) <= 32
    and coalesce(length(tamp_type), 0) <= 32
    and coalesce(length(taste_flavor), 0) <= 32
    and coalesce(length(taste_strength), 0) <= 32
    and coalesce(length(bean_age_bucket), 0) <= 16
    and coalesce(length(roast_level), 0) <= 32
  ) not valid;

create or replace function public.public_shots_daily_cap()
returns trigger language plpgsql security definer set search_path = public as $$
declare n bigint;
begin
  select count(*) into n from public.public_shots where created_at > now() - interval '24 hours';
  if n >= 20000 then
    raise exception 'public_shots daily cap reached' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists public_shots_daily_cap on public.public_shots;
create trigger public_shots_daily_cap before insert on public.public_shots
  for each row execute function public.public_shots_daily_cap();

-- 3. Only signed-in users can call account deletion.
revoke execute on function public.delete_user_account() from public, anon;
grant execute on function public.delete_user_account() to authenticated, service_role;

-- 4. Dataset clean-up (D82): keep the newest row per source_id, drop impossible shots.
create temporary table _before as select count(*) as n from public.public_shots;

delete from public.public_shots where id in (
  select id from (
    select id, row_number() over (partition by source_id order by created_at desc, id desc) as rn
    from public.public_shots where source_id is not null
  ) d where rn > 1
);

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

-- 5. One row per source_id from now on (the table is small, so a plain index is instant).
create unique index if not exists public_shots_source_id_key on public.public_shots (source_id);

commit;

-- 6. What changed (expect: rows before about 399, rows after about 324, the rest true).
select
  (select n from _before)                                                            as rows_before,
  (select count(*) from public.public_shots)                                         as rows_after,
  exists (select 1 from pg_policies where tablename = 'shots'
          and policyname = 'owners delete their own shots')                          as delete_policy_ok,
  exists (select 1 from pg_trigger where tgname = 'public_shots_daily_cap')          as daily_cap_ok,
  exists (select 1 from pg_indexes where indexname = 'public_shots_source_id_key')   as unique_index_ok,
  not has_function_privilege('anon', 'public.delete_user_account()', 'execute')      as anon_cannot_delete_ok;
