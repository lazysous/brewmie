-- 7-day Premium trial on first sign-in.
--
-- profiles.trial_started_at is set once, the first time fetchTier runs for a
-- new authenticated user (server-side authoritative — see start_trial RPC).
-- A user is considered "in trial" if now() < trial_started_at + 7 days AND
-- their tier is still 'free'. Once the trial ends, useTier() falls back to
-- the persisted tier ('free' unless they convert to paid).
--
-- Run this once against the prod Supabase via:
--   psql $DATABASE_URL -f supabase/add_trial_started_at.sql
-- or paste into the Supabase SQL editor.

alter table public.profiles
  add column if not exists trial_started_at timestamptz;

-- RPC: start the trial atomically on first read. Idempotent — if
-- trial_started_at is already set, the existing value is returned.
create or replace function public.start_trial()
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_started timestamptz;
begin
  if v_uid is null then
    return null;
  end if;

  -- Insert profile row if missing, set trial_started_at if not yet set.
  insert into profiles (id, tier, trial_started_at)
    values (v_uid, 'free', now())
    on conflict (id) do update
      set trial_started_at = coalesce(profiles.trial_started_at, excluded.trial_started_at)
    returning trial_started_at into v_started;

  return v_started;
end;
$$;

grant execute on function public.start_trial() to authenticated;

-- View that reports effective tier (paid 'premium' OR active trial). The
-- client can either compute this client-side from (tier, trial_started_at)
-- or read this view directly.
create or replace view public.effective_tier as
select
  id,
  case
    when tier = 'premium' then 'premium'
    when trial_started_at is not null
         and now() < trial_started_at + interval '7 days' then 'premium'
    else 'free'
  end as effective_tier,
  tier as base_tier,
  trial_started_at,
  case
    when trial_started_at is not null
         and now() < trial_started_at + interval '7 days'
    then trial_started_at + interval '7 days'
    else null
  end as trial_ends_at
from public.profiles;

grant select on public.effective_tier to authenticated;
