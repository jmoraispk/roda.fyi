-- supabase/migrations/202611010003_notification_results.sql
-- Phone notifications, part 3: what the sender reports back (Ruling 10).

create function private.report_notification_results(at_time timestamptz, results jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  outcome record;
  removed integer := 0;
  changed integer;
begin
  if jsonb_typeof(results) is distinct from 'array' then
    raise exception using errcode = 'P0001', message = 'invalid_results';
  end if;

  for outcome in
    select (item ->> 'subscription_id')::uuid as subscription_id, item ->> 'status' as status
      from jsonb_array_elements(results) delivery_result
      cross join lateral jsonb_array_elements(coalesce(delivery_result -> 'outcomes', '[]'::jsonb)) item
  loop
    if outcome.status = 'sent' then
      update public.push_subscriptions device
         set last_sent_at = at_time, failures = 0
       where device.id = outcome.subscription_id;
    elsif outcome.status = 'gone' then
      delete from public.push_subscriptions device where device.id = outcome.subscription_id;
      get diagnostics changed = row_count;
      removed := removed + changed;
    elsif outcome.status = 'failed' then
      update public.push_subscriptions device
         set failures = device.failures + 1
       where device.id = outcome.subscription_id;
      delete from public.push_subscriptions device
       where device.id = outcome.subscription_id and device.failures >= 10;
      get diagnostics changed = row_count;
      removed := removed + changed;
    end if;
  end loop;

  update public.notification_deliveries delivery
     set status = case when summary.any_sent then 'sent' when summary.any_failed then 'pending' else 'failed' end,
         sent_at = case when summary.any_sent then at_time end
    from (
      select (delivery_result ->> 'delivery_id')::uuid as id,
             coalesce(bool_or(item ->> 'status' = 'sent'), false) as any_sent,
             coalesce(bool_or(item ->> 'status' = 'failed'), false) as any_failed
        from jsonb_array_elements(results) delivery_result
        left join lateral jsonb_array_elements(coalesce(delivery_result -> 'outcomes', '[]'::jsonb)) item on true
       group by 1
    ) summary
   where delivery.id = summary.id
     and delivery.status = 'pending';

  return jsonb_build_object('status', 'reported', 'removed_devices', removed);
end;
$$;

create function public.report_notification_results(results jsonb)
returns jsonb
language sql
set search_path = ''
as $$ select private.report_notification_results(now(), results); $$;

revoke execute on function private.report_notification_results(timestamptz, jsonb) from public, anon, authenticated;
grant execute on function private.report_notification_results(timestamptz, jsonb) to service_role;
revoke execute on function public.report_notification_results(jsonb) from public, anon, authenticated;
grant execute on function public.report_notification_results(jsonb) to service_role;
