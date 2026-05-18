-- Brewmie: account deletion.
--
-- Wipes the caller's rows from shots + profiles then deletes the auth.user.
-- Caller must be authenticated. Runs as SECURITY DEFINER so it can reach
-- auth.users (the role the function runs as needs permission on auth schema).
--
-- Apply via Supabase SQL editor (or `supabase db push` if you're using the CLI).

create or replace function public.delete_user_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  delete from public.shots where user_id = uid;
  delete from public.profiles where id = uid;
  -- auth.users cascades the deletion to any leftover refresh_tokens/sessions.
  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_user_account() from public;
grant execute on function public.delete_user_account() to authenticated;
