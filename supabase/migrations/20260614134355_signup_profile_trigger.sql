-- Signup: auto-create a profile (with the chosen username) for every new auth user.
-- email + password live in Supabase Auth (auth.users); username + a mirrored
-- email live in public.profiles. The username arrives via signUp() user metadata.

-- mirror email onto profiles so all three signup fields are visible in one table
alter table profiles add column if not exists email text;

-- create the profile row whenever someone signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_handle text := coalesce(nullif(new.raw_user_meta_data->>'username', ''), split_part(new.email, '@', 1));
begin
  begin
    insert into public.profiles (id, handle, display_name, email)
    values (new.id, v_handle, v_handle, new.email);
  exception when unique_violation then
    -- username already taken -> fall back to a unique variant so signup still succeeds
    insert into public.profiles (id, handle, display_name, email)
    values (new.id, v_handle || '-' || substr(new.id::text, 1, 4), v_handle, new.email)
    on conflict (id) do nothing;
  end;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- backfill email for the existing seeded profiles
update public.profiles p
set email = u.email
from auth.users u
where u.id = p.id and p.email is null;
