-- D&D Charakterbögen – install once in a NEW, DEDICATED Supabase project.
-- Security: secrets are not present here. Only SHA-256 hashes of random 224–288-bit codes.
-- IMPORTANT: Do not reuse an unrelated Supabase project without permission.

begin;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists game_private;
revoke all on schema game_private from public, anon, authenticated;

create table if not exists public.game_masters (
  id smallint primary key default 1 check (id = 1),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.character_slots (
  char_key text primary key check (char_key in ('len','gra','sas','pei')),
  display_name text not null,
  owner_id uuid unique references auth.users(id) on delete set null,
  sheet jsonb not null default '{}'::jsonb check (jsonb_typeof(sheet) = 'object' and pg_column_size(sheet) < 262144),
  updated_at timestamptz not null default now()
);

create table if not exists game_private.invites (
  char_key text primary key references public.character_slots(char_key) on delete cascade,
  claim_hash text not null check (length(claim_hash) = 64)
);
create table if not exists game_private.admin_access (
  id smallint primary key default 1 check (id=1),
  claim_hash text not null check (length(claim_hash) = 64)
);

insert into public.character_slots (char_key,display_name) values
  ('len', 'Lennox'),
  ('gra', 'Grandia Rythna'),
  ('sas', 'Sashee'),
  ('pei', 'Peisinoe')
on conflict (char_key) do nothing;

insert into game_private.invites (char_key,claim_hash) values
  ('len', 'd3b6b5278390abd9a3cf5084cef0c7ddcb4030488a1d54d8e991a6915781a28d'),
  ('gra', 'fa4aa73892c795d7d0db28ce38c75cea478e6ed4ad9b5d85d0a3b6901e5cc37c'),
  ('sas', '2c82d3275137288a19ef06b15ee1395af78e0ab6ff93df081bdefd36e428b512'),
  ('pei', 'effb77ac7f6d2df731e129863a6837156d5a5bdece55fb2b29ea5961d0bf0afe')
on conflict (char_key) do nothing;

insert into game_private.admin_access (id,claim_hash)
values (1, 'fdd05ed60759344262e9f87aca8b8842d87ee58fa94c484dc17547fd7facbd52')
on conflict (id) do nothing;

-- Data-API protection: no public writes, and only sheet is writable by its owner.
alter table public.game_masters enable row level security;
alter table public.character_slots enable row level security;
alter table game_private.invites enable row level security;
alter table game_private.admin_access enable row level security;

revoke all on public.game_masters from anon, authenticated;
revoke all on public.character_slots from anon, authenticated;
revoke all on game_private.invites from anon, authenticated;
revoke all on game_private.admin_access from anon, authenticated;
grant select on public.game_masters to authenticated;
grant select on public.character_slots to authenticated;
grant update (sheet) on public.character_slots to authenticated;

create policy gm_can_see_self on public.game_masters
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy owner_or_gm_can_see_sheet on public.character_slots
  for select to authenticated
  using (owner_id = (select auth.uid())
    or exists (select 1 from public.game_masters g where g.user_id = (select auth.uid())));

create policy owner_can_edit_sheet on public.character_slots
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- Run using the Supabase SQL editor's administrative role. The functions
-- require an authenticated session, never trust caller-supplied user IDs.
create or replace function public.claim_character(p_character_key text, p_code text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_updated integer;
begin
  if v_user is null then raise exception 'Anmeldung erforderlich'; end if;
  if p_character_key not in ('len','gra','sas','pei') then raise exception 'Unbekannter Charakter'; end if;
  if p_code is null or length(p_code) > 256 then raise exception 'Ungültiger Einladungscode'; end if;
  if exists (select 1 from public.game_masters where user_id = v_user) then
    raise exception 'Spielleiter dürfen keinen Spielercharakter übernehmen';
  end if;
  if exists (select 1 from public.character_slots where owner_id = v_user) then
    raise exception 'Ein Charakter ist bereits zugewiesen';
  end if;
  if not exists (
    select 1 from game_private.invites
    where char_key = p_character_key
    and claim_hash = pg_catalog.encode(extensions.digest(p_code, 'sha256'), 'hex')
  ) then
    raise exception 'Einladungscode stimmt nicht';
  end if;
  update public.character_slots
     set owner_id = v_user,
         sheet = '{}'::jsonb,
         updated_at = now()
   where char_key = p_character_key and owner_id is null;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then raise exception 'Charakter ist bereits vergeben'; end if;
end;
$$;

create or replace function public.claim_gm(p_code text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_inserted integer;
begin
  if v_user is null then raise exception 'Anmeldung erforderlich'; end if;
  if p_code is null or length(p_code) > 256 then raise exception 'Ungültiger Spielleiter-Code'; end if;
  if exists (select 1 from public.character_slots where owner_id = v_user) then
    raise exception 'Spielerkonto kann kein Spielleiterkonto werden';
  end if;
  if not exists (
    select 1 from game_private.admin_access
    where id=1 and claim_hash = pg_catalog.encode(extensions.digest(p_code, 'sha256'), 'hex')
  ) then
    raise exception 'Spielleiter-Code stimmt nicht';
  end if;
  insert into public.game_masters (id,user_id) values (1,v_user)
    on conflict (id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted <> 1 and not exists (
    select 1 from public.game_masters where user_id=v_user
  ) then raise exception 'Spielleiter bereits vergeben'; end if;
end;
$$;

-- A trigger updates the timestamp without giving players permission to edit owner IDs.
create or replace function public.stamp_character_sheet()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger character_sheet_stamp
before update on public.character_slots
for each row execute function public.stamp_character_sheet();

revoke all on function public.claim_character(text,text) from public, anon;
revoke all on function public.claim_gm(text) from public, anon;
revoke all on function public.stamp_character_sheet() from public, anon, authenticated;
grant execute on function public.claim_character(text,text) to authenticated;
grant execute on function public.claim_gm(text) to authenticated;

-- Realtime update events. The channel receives only records visible under RLS.
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname='public' and tablename='character_slots'
  ) then
    alter publication supabase_realtime add table public.character_slots;
  end if;
end;
$$;
commit;