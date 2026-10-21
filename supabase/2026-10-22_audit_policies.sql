-- Audit 2026-10 (brewmie-02, brewmie-22, brewmie-58). Paste the whole file into the Supabase
-- SQL editor (project pdbfmmtwgsdkattjraya) and run it once. Every statement is idempotent.

-- brewmie-02: signed-in users may delete their own shots. The app has sent deletes since
-- OTA 1.1.6 (tombstones on the device); without this policy they are silent no-ops.
drop policy if exists "owners delete their own shots" on public.shots;
create policy "owners delete their own shots"
  on public.shots for delete to authenticated
  using (auth.uid() = user_id);

-- brewmie-22: bound the anonymous community rows. Text columns are short labels; a daily cap
-- stops a script from filling the free tier (the app posts at most a handful per person per day).
alter table public.public_shots
  drop constraint if exists public_shots_text_bounds;
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
  ) not valid;  -- existing rows are not re-checked; new rows are

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

-- brewmie-58: the account-deletion function is for signed-in users only.
revoke execute on function public.delete_user_account() from public, anon;
grant execute on function public.delete_user_account() to authenticated, service_role;
