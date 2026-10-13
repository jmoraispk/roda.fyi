-- supabase/migrations/202610250003_discover_search_cap.sql
-- Ruling 18: search only the first 100 characters. No city, person, or group
-- label is longer than 120, and a huge query must not be scanned with.
create or replace function public.discover_search(search_text text, result_limit integer default 20)
returns table (
  kind text, profile_id uuid, group_id uuid, label text, city text, region text, country text,
  lat numeric, lng numeric, person_count integer
)
language sql stable set search_path = ''
as $$ select * from private.discover_search(auth.uid(), left(search_text, 100), result_limit); $$;
