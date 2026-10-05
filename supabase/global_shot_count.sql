-- Global shot counter — total shots logged across every user, all time.
--
-- Every shot pulled in the app gets one logical entry. Depending on user state
-- it materialises in one or both backend tables:
--
--   table          written when                            primary key
--   ------------   ------------------------------------    -----------
--   shots          user is signed in                       shot.id (client UUID)
--   public_shots   user has analytics on (default)         server UUID; source_id = shot.id
--
-- A signed-in user with analytics on writes to BOTH tables for the same shot,
-- linked via public_shots.source_id = shots.id. A signed-in user who opted out
-- writes to shots only. An anonymous user writes to public_shots only. To
-- count each physical shot exactly once we union by client id.
--
-- security definer bypasses RLS so we never return a row, only the aggregate.
-- Safe to expose to anon + authenticated.
--
-- Run once against prod:
--   psql $DATABASE_URL -f supabase/global_shot_count.sql
-- or paste into the Supabase SQL editor.

create or replace function public.global_shot_count()
returns bigint
language sql
security definer
set search_path = public
as $$
  select count(*)::bigint from (
    select id from public.shots
    union
    select coalesce(source_id, id::text) from public.public_shots
  ) all_shots;
$$;

grant execute on function public.global_shot_count() to anon, authenticated;
