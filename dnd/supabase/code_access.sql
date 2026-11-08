-- D&D code-only login (no email/SMTP required). Apply after schema.sql.
-- Database API uses the existing random invitation codes as bearer credentials.
-- The plaintext codes are NEVER stored in SQL or shipped to GitHub.
-- All direct table reads/writes by anon stay revoked; protected RPC only.
begin;
create or replace function public.read_character(p_character_key text, p_code text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare v_sheet jsonb;
begin
  if p_character_key is null or p_character_key not in ('len','gra','sas','pei')
     or p_code is null or p_code !~ '^[A-Za-z0-9_-]{20,100}$' then
    raise exception 'Ungültiger Charaktercode';
  end if;
  if not exists (
    select 1 from game_private.invites i
    where i.char_key=p_character_key
      and i.claim_hash=pg_catalog.encode(extensions.digest(p_code,'sha256'),'hex')
  ) then raise exception 'Ungültiger Charaktercode'; end if;
  select s.sheet into v_sheet from public.character_slots s
  where s.char_key=p_character_key;
  if not found then raise exception 'Unbekannter Charakter'; end if;
  return v_sheet;
end;
$$;

create or replace function public.write_character(p_character_key text, p_code text, p_sheet jsonb)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if p_character_key is null or p_character_key not in ('len','gra','sas','pei')
     or p_code is null or p_code !~ '^[A-Za-z0-9_-]{20,100}$' then
    raise exception 'Ungültiger Charaktercode';
  end if;
  if not exists (
    select 1 from game_private.invites i
    where i.char_key=p_character_key
      and i.claim_hash=pg_catalog.encode(extensions.digest(p_code,'sha256'),'hex')
  ) then raise exception 'Ungültiger Charaktercode'; end if;
  if p_sheet is null or pg_catalog.jsonb_typeof(p_sheet)<>'object'
     or pg_catalog.pg_column_size(p_sheet)>200000
     or p_sheet->>'char' is distinct from p_character_key then
    raise exception 'Ungültiger Charakterbogen'; end if;
  update public.character_slots set sheet=p_sheet
  where char_key=p_character_key;
  if not found then raise exception 'Unbekannter Charakter'; end if;
end;
$$;

create or replace function public.read_party(p_code text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare v_rows jsonb;
begin
  if p_code is null or p_code !~ '^[A-Za-z0-9_-]{20,100}$'
     or not exists (
       select 1 from game_private.admin_access a
       where a.id=1 and a.claim_hash=pg_catalog.encode(extensions.digest(p_code,'sha256'),'hex')
     ) then raise exception 'Ungültiger Spielleiter-Code'; end if;
  select coalesce(pg_catalog.jsonb_agg(
     pg_catalog.jsonb_build_object('char_key',s.char_key,'display_name',s.display_name,'sheet',s.sheet)
     order by s.char_key), '[]'::jsonb)
    into v_rows from public.character_slots s;
  return v_rows;
end;
$$;

revoke all on function public.read_character(text,text) from public,anon,authenticated;
revoke all on function public.write_character(text,text,jsonb) from public,anon,authenticated;
revoke all on function public.read_party(text) from public,anon,authenticated;
grant execute on function public.read_character(text,text) to anon;
grant execute on function public.write_character(text,text,jsonb) to anon;
grant execute on function public.read_party(text) to anon;

-- Old email-account signup endpoints are no longer used by this app.
revoke execute on function public.claim_character(text,text) from authenticated;
revoke execute on function public.claim_gm(text) from authenticated;
commit;