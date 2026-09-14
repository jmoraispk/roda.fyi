\set ON_ERROR_STOP on

create schema if not exists tests;

create or replace function tests.create_user(
  user_id uuid,
  user_email text,
  user_name text default null
)
returns void
language sql
set search_path = ''
as $$
  insert into auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    recovery_token,
    email_change,
    email_change_token_new
  )
  values (
    '00000000-0000-0000-0000-000000000000',
    user_id,
    'authenticated',
    'authenticated',
    lower(user_email),
    extensions.crypt('test-password', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    case
      when user_name is null then '{}'::jsonb
      else jsonb_build_object('full_name', user_name)
    end,
    now(),
    now(),
    '',
    '',
    '',
    ''
  );
$$;

create or replace function tests.set_actor(
  user_id uuid,
  database_role text default 'authenticated'
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(user_id::text, ''), true);
  perform set_config('request.jwt.claim.role', database_role, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', user_id, 'role', database_role)::text,
    true
  );
  execute format('set local role %I', database_role);
end;
$$;

create or replace function tests.reset_actor()
returns void
language plpgsql
set search_path = ''
as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '{}', true);
end;
$$;
