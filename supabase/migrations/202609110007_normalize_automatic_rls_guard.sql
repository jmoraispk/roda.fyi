create or replace function private.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  command record;
begin
  for command in
    select *
      from pg_catalog.pg_event_trigger_ddl_commands()
     where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
       and object_type in ('table', 'partitioned table')
  loop
    if command.schema_name = 'public' then
      begin
        execute pg_catalog.format(
          'alter table if exists %s enable row level security',
          command.object_identity
        );
        raise log 'rls_auto_enable: enabled RLS on %', command.object_identity;
      exception
        when others then
          raise log 'rls_auto_enable: failed to enable RLS on %', command.object_identity;
      end;
    end if;
  end loop;
end;
$$;

drop event trigger if exists ensure_rls;
create event trigger ensure_rls
on ddl_command_end
when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
execute function private.rls_auto_enable();

revoke execute on function private.rls_auto_enable() from public, anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all on sequences from service_role;
