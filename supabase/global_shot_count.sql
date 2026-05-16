-- Global shot counter — total shots logged across every user, all time.
--
-- The shots table is RLS-protected so users can only read their own rows.
-- This RPC bypasses RLS to return just the aggregate count, never a row.
-- Safe to expose to anonymous + authenticated.
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
  select count(*)::bigint from public.shots;
$$;

grant execute on function public.global_shot_count() to anon, authenticated;
