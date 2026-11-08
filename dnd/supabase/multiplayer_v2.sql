begin;
create schema if not exists game_private;
create table if not exists public.dnd_room (
  id smallint primary key default 1 check (id=1),
  session_id uuid not null default gen_random_uuid(),
  title text not null default 'Unsere D&D-Runde' check (length(title) between 1 and 100),
  status text not null default 'waiting' check (status in ('waiting','active','paused','ended')),
  started_at timestamptz,
  ended_at timestamptz,
  updated_at timestamptz not null default now(),
  gm_notes text not null default '' check (length(gm_notes) <= 12000)
);
insert into public.dnd_room(id) values(1) on conflict(id) do nothing;
create table if not exists public.dnd_rolls (
  id bigint generated always as identity primary key,
  session_id uuid not null,
  request_id uuid not null unique,
  actor_key text not null check (actor_key in ('len','gra','sas','pei','gm')),
  label text not null check (length(label) between 1 and 100),
  formula text not null check (length(formula) <= 25),
  faces integer not null check (faces in (4,6,8,10,12,20,100)),
  individual_rolls jsonb not null,
  chosen_rolls jsonb not null,
  modifier integer not null check (modifier between -100 and 100),
  advantage smallint not null default 0 check (advantage between -1 and 1),
  total integer not null,
  visibility text not null check (visibility in ('public','gm')),
  created_at timestamptz not null default now()
);
create index if not exists dnd_rolls_session_id_idx on public.dnd_rolls(session_id,id desc);
create table if not exists public.dnd_presence (
  actor_key text primary key check (actor_key in ('len','gra','sas','pei','gm')),
  last_seen_at timestamptz not null default now()
);
alter table public.dnd_room enable row level security;
alter table public.dnd_rolls enable row level security;
alter table public.dnd_presence enable row level security;
revoke all on public.dnd_room,public.dnd_rolls,public.dnd_presence from public,anon,authenticated;
revoke all on sequence public.dnd_rolls_id_seq from public,anon,authenticated;
create or replace function game_private.dnd_code_ok(p_actor text,p_code text)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(p_actor in ('len','gra','sas','pei','gm')
   and p_code ~ '^[A-Za-z0-9_-]{20,100}$'
   and (
     (p_actor='gm' and exists (
       select 1 from game_private.admin_access a
       where a.id=1 and a.claim_hash=pg_catalog.encode(extensions.digest(p_code,'sha256'),'hex')))
     or
     (p_actor<>'gm' and exists (
       select 1 from game_private.invites i
       where i.char_key=p_actor and i.claim_hash=pg_catalog.encode(extensions.digest(p_code,'sha256'),'hex')))
   ),false);
$$;
revoke all on function game_private.dnd_code_ok(text,text) from public,anon,authenticated;
create or replace function public.dnd_snapshot(p_actor text,p_code text,p_after bigint default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_room record; v_party jsonb; v_rolls jsonb; v_online jsonb; v_last bigint;
begin
 if not game_private.dnd_code_ok(p_actor,p_code) then raise exception 'Zugangscode ungültig'; end if;
 if p_after is null or p_after<0 then p_after:=0; end if;
 select * into v_room from public.dnd_room where id=1;
 select coalesce(jsonb_agg(jsonb_build_object(
     'key',s.char_key,'name',coalesce(nullif(s.sheet->>'name',''),s.display_name),
     'class',s.sheet->>'cls','level',s.sheet->'lvl',
     'hp',s.sheet->'hp','hpMax',s.sheet->'hpMax',
     'tmp',s.sheet->'tmp','ac',s.sheet->'ac',
     'status',coalesce(nullif(s.sheet->>'status',''),'bereit')
    ) order by s.char_key),'[]'::jsonb) into v_party
 from public.character_slots s;
 select coalesce(jsonb_agg(x.v order by x.id),'[]'::jsonb) into v_rolls from (
   select r.id,to_jsonb(r) as v from public.dnd_rolls r
   where r.session_id=v_room.session_id
     and (r.visibility='public' or p_actor='gm')
     and (p_after=0 or r.id>p_after)
   order by r.id desc limit 70
 ) x;
 select coalesce(jsonb_agg(jsonb_build_object('key',actor_key,'seen',last_seen_at)),'[]'::jsonb)
 into v_online from public.dnd_presence
 where last_seen_at>now()-interval '50 seconds';
 select coalesce(max(r.id),0) into v_last from public.dnd_rolls r
   where r.session_id=v_room.session_id and (r.visibility='public' or p_actor='gm');
 return jsonb_build_object(
   'session',jsonb_build_object('id',v_room.session_id,'title',v_room.title,
      'status',v_room.status,'started',v_room.started_at,'ended',v_room.ended_at,
      'updated',v_room.updated_at),
   'party',v_party,'rolls',v_rolls,'online',v_online,'latest_id',v_last,
   'gm_notes',case when p_actor='gm' then to_jsonb(v_room.gm_notes) else 'null'::jsonb end);
end;
$$;
create or replace function public.dnd_heartbeat(p_actor text,p_code text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not game_private.dnd_code_ok(p_actor,p_code) then raise exception 'Zugangscode ungültig'; end if;
 insert into public.dnd_presence(actor_key,last_seen_at) values(p_actor,now())
 on conflict(actor_key) do update set last_seen_at=excluded.last_seen_at;
end;
$$;
create or replace function public.dnd_gm_manage(p_code text,p_action text,p_title text default null,p_notes text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_room public.dnd_room%rowtype;
begin
 if not game_private.dnd_code_ok('gm',p_code) then raise exception 'Nur Spielleiter'; end if;
 select * into v_room from public.dnd_room where id=1 for update;
 if p_action='start' then
   if v_room.status in ('active','paused') then raise exception 'Laufende Sitzung zuerst beenden'; end if;
   update public.dnd_room set session_id=gen_random_uuid(),
     title=left(coalesce(nullif(trim(p_title),''),'Unsere D&D-Runde'),100),
     status='active',started_at=now(),ended_at=null,updated_at=now()
   where id=1;
 elsif p_action='pause' then
   if v_room.status<>'active' then raise exception 'Sitzung ist nicht aktiv'; end if;
   update public.dnd_room set status='paused',updated_at=now() where id=1;
 elsif p_action='resume' then
   if v_room.status<>'paused' then raise exception 'Sitzung ist nicht pausiert'; end if;
   update public.dnd_room set status='active',updated_at=now() where id=1;
 elsif p_action='end' then
   if v_room.status not in ('active','paused') then raise exception 'Keine laufende Sitzung'; end if;
   update public.dnd_room set status='ended',ended_at=now(),updated_at=now() where id=1;
 elsif p_action='notes' then
   if p_notes is null or length(p_notes)>12000 then raise exception 'Ungültige Notizen'; end if;
   update public.dnd_room set gm_notes=p_notes,updated_at=now() where id=1;
 else
   raise exception 'Unbekannte Aktion';
 end if;
 return public.dnd_snapshot('gm',p_code,0)->'session';
end;
$$;
create or replace function public.dnd_roll(p_actor text,p_code text,p_formula text,p_label text,
 p_visibility text default 'public',p_request_id uuid default null,p_adv smallint default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_match text[]; v_n int; v_faces int; v_modifier int; v_raw int;
 v_bytes bytea; v_limit bigint; v_raw_rolls int[]:='{}'; v_chosen int[]:='{}';
 v_i int; v_total int:=0; v_room public.dnd_room%rowtype; v_existing public.dnd_rolls%rowtype;
 v_result public.dnd_rolls%rowtype; v_selected int; v_a int; v_b int;
begin
 if not game_private.dnd_code_ok(p_actor,p_code) then raise exception 'Zugangscode ungültig'; end if;
 if p_request_id is null then raise exception 'Request-ID erforderlich'; end if;
 if p_visibility not in ('public','gm') or (p_visibility='gm' and p_actor<>'gm')
    then raise exception 'Sichtbarkeit nicht erlaubt'; end if;
 if p_label is null or length(trim(p_label)) not between 1 and 100 then raise exception 'Ungültiger Würfelname'; end if;
 if p_formula is null or length(p_formula)>25 then raise exception 'Ungültige Formel'; end if;
 v_match:=regexp_match(lower(replace(trim(p_formula),' ','')),'^([0-9]{0,2})d(4|6|8|10|12|20|100)([+-][0-9]{1,3})?$');
 if v_match is null then raise exception 'Erlaubt: 1d20+5, 2d6, 1d100'; end if;
 v_n:=coalesce(nullif(v_match[1],''),'1')::int;
 v_faces:=v_match[2]::int;
 v_modifier:=coalesce(v_match[3],'0')::int;
 if v_n<1 or v_n>20 or v_modifier < -100 or v_modifier > 100
    then raise exception 'Würfelgrenzen überschritten'; end if;
 if p_adv is null or p_adv not in (-1,0,1) or (p_adv<>0 and (v_n<>1 or v_faces<>20))
    then raise exception 'Vorteil/Nachteil nur bei einem W20'; end if;
 select * into v_room from public.dnd_room where id=1;
 if v_room.status<>'active' then raise exception 'Spielleiter muss Sitzung starten'; end if;
 select * into v_existing from public.dnd_rolls where request_id=p_request_id;
 if found then
   if v_existing.actor_key<>p_actor or v_existing.session_id<>v_room.session_id
      or v_existing.formula<>lower(replace(trim(p_formula),' ',''))
      then raise exception 'Request-ID bereits verwendet'; end if;
   return to_jsonb(v_existing);
 end if;
 v_limit:=4294967296::bigint-(4294967296::bigint % v_faces);
 -- Generate a uniform unsigned 32-bit integer with rejection sampling.
 for v_i in 1..(case when p_adv=0 then v_n else 2 end) loop
   loop
     v_bytes:=extensions.gen_random_bytes(4);
     if (get_byte(v_bytes,0)::bigint*16777216+
         get_byte(v_bytes,1)::bigint*65536+
         get_byte(v_bytes,2)::bigint*256+
         get_byte(v_bytes,3)::bigint)<v_limit then exit; end if;
   end loop;
   v_raw_rolls:=array_append(v_raw_rolls,((get_byte(v_bytes,0)::bigint*16777216+
       get_byte(v_bytes,1)::bigint*65536+get_byte(v_bytes,2)::bigint*256+
       get_byte(v_bytes,3)::bigint)%v_faces+1)::int);
 end loop;
 if p_adv=1 then v_chosen:=array[greatest(v_raw_rolls[1],v_raw_rolls[2])];
 elsif p_adv=-1 then v_chosen:=array[least(v_raw_rolls[1],v_raw_rolls[2])];
 else v_chosen:=v_raw_rolls; end if;
 select coalesce(sum(a),0) into v_total from unnest(v_chosen) a;
 v_total:=v_total+v_modifier;
 insert into public.dnd_rolls(session_id,request_id,actor_key,label,formula,faces,
  individual_rolls,chosen_rolls,modifier,advantage,total,visibility)
 values(v_room.session_id,p_request_id,p_actor,trim(p_label),
  lower(replace(trim(p_formula),' ','')),v_faces,to_jsonb(v_raw_rolls),
  to_jsonb(v_chosen),v_modifier,p_adv,v_total,p_visibility)
 on conflict(request_id) do nothing returning * into v_result;
 if not found then
   select * into v_existing from public.dnd_rolls where request_id=p_request_id;
   if v_existing.actor_key<>p_actor or v_existing.session_id<>v_room.session_id
     then raise exception 'Request-ID bereits verwendet'; end if;
   return to_jsonb(v_existing);
 end if;
 return to_jsonb(v_result);
end;
$$;
revoke all on function public.dnd_snapshot(text,text,bigint) from public,anon,authenticated;
revoke all on function public.dnd_heartbeat(text,text) from public,anon,authenticated;
revoke all on function public.dnd_gm_manage(text,text,text,text) from public,anon,authenticated;
revoke all on function public.dnd_roll(text,text,text,text,text,uuid,smallint) from public,anon,authenticated;
grant execute on function public.dnd_snapshot(text,text,bigint) to anon;
grant execute on function public.dnd_heartbeat(text,text) to anon;
grant execute on function public.dnd_gm_manage(text,text,text,text) to anon;
grant execute on function public.dnd_roll(text,text,text,text,text,uuid,smallint) to anon;
commit;