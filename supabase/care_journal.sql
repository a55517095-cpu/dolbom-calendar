-- ============================================================================
--  돌봄 근무일지 — Supabase 저장소
--
--  해설사 근무표와 "같은" Supabase 프로젝트의  대시보드 > SQL Editor  에 전체를 붙여넣고 실행하세요.
--  (여러 번 실행해도 안전하도록 작성되어 있습니다)
--
--  만드는 것
--    care_logs      돌봄 일지  (날짜 · 시작 · 끝 · 대상·장소 · 한 일 · 특이사항)
--    care_events    한 줄 일정 (날짜 · 시간 · 메뉴 · 내용)
--    care_menus     상단 보기 메뉴 (이름 · 색)
--    care_settings  AI 연결 키 (말로 채우기)
--
--  보안: 모든 줄은 쓴 사람(owner_id) 본인만 읽고 쓸 수 있습니다. 근무표의 다른 해설사는 볼 수 없습니다.
--  owner_id 는 근무표 명단(members)의 id 이고, 넣지 않으면 로그인한 사람으로 채워집니다.
-- ============================================================================

-- --- 1. 표 -------------------------------------------------------------------

create table if not exists public.care_logs (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default public.current_member_id() references public.members(id) on delete cascade,
  log_date     date not null,
  start_time   text check (start_time is null or start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  end_time     text check (end_time   is null or end_time   ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  client_name  text,
  work_done    text not null,
  special_note text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists care_logs_owner_date_idx on public.care_logs (owner_id, log_date);

create table if not exists public.care_events (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default public.current_member_id() references public.members(id) on delete cascade,
  event_date  date not null,
  event_time  text check (event_time is null or event_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  menu_id     text not null default 'event',
  body        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists care_events_owner_date_idx on public.care_events (owner_id, event_date);

create table if not exists public.care_menus (
  owner_id    uuid not null default public.current_member_id() references public.members(id) on delete cascade,
  id          text not null,
  name        text not null,
  color       text not null,
  sort_order  int  not null default 0,
  primary key (owner_id, id)
);

create table if not exists public.care_settings (
  owner_id          uuid primary key default public.current_member_id() references public.members(id) on delete cascade,
  anthropic_api_key text,
  updated_at        timestamptz not null default now()
);

-- --- 2. 고칠 때 수정 시각을 자동으로 --------------------------------------------

create or replace function public.care_touch_updated_at()
returns trigger language plpgsql as $fn$
begin
  new.updated_at := now();
  return new;
end $fn$;

drop trigger if exists care_logs_touch on public.care_logs;
create trigger care_logs_touch before update on public.care_logs
  for each row execute function public.care_touch_updated_at();

drop trigger if exists care_events_touch on public.care_events;
create trigger care_events_touch before update on public.care_events
  for each row execute function public.care_touch_updated_at();

drop trigger if exists care_settings_touch on public.care_settings;
create trigger care_settings_touch before update on public.care_settings
  for each row execute function public.care_touch_updated_at();

-- --- 3. 보안 (행 수준 보안) — 본인 것만 -----------------------------------------

alter table public.care_logs     enable row level security;
alter table public.care_events   enable row level security;
alter table public.care_menus    enable row level security;
alter table public.care_settings enable row level security;

do $blk$
declare t text;
begin
  foreach t in array array['care_logs','care_events','care_menus','care_settings'] loop
    execute format('drop policy if exists %I on public.%I', t || '_own', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (owner_id = public.current_member_id()) with check (owner_id = public.current_member_id())',
      t || '_own', t);
  end loop;
end $blk$;

-- --- 4. 메뉴 저장 (한 번에) -----------------------------------------------------
-- 메뉴 목록을 통째로 바꾸고, 지운 메뉴의 일정은 기본 「일정」으로 옮긴다.
-- 한 번의 트랜잭션이라 메뉴는 지워졌는데 일정만 남는 일이 없다.

create or replace function public.save_care_menus(p_menus jsonb)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  me uuid := public.current_member_id();
begin
  if me is null then raise exception '로그인이 필요합니다.'; end if;
  if jsonb_typeof(p_menus) <> 'array' then raise exception '메뉴 목록이 올바르지 않습니다.'; end if;

  delete from public.care_menus where owner_id = me;

  insert into public.care_menus (owner_id, id, name, color, sort_order)
  select me,
         m->>'id',
         left(m->>'name', 10),
         m->>'color',
         ord - 1
    from jsonb_array_elements(p_menus) with ordinality as t(m, ord)
   where (m->>'id') ~ '^[A-Za-z0-9_-]{1,40}$'
     and coalesce(m->>'name', '') <> ''
     and (m->>'color') ~ '^#[0-9a-fA-F]{6}$';

  -- 지워진 메뉴의 일정은 「일정」으로
  update public.care_events e
     set menu_id = 'event'
   where e.owner_id = me
     and e.menu_id not in ('event')
     and not exists (select 1 from public.care_menus m where m.owner_id = me and m.id = e.menu_id);
end $fn$;

grant execute on function public.save_care_menus(jsonb) to authenticated;

-- --- 5. 실시간 반영 (PC ↔ 휴대폰) -----------------------------------------------
-- 다른 기기에서 쓴 기록이 바로 보이도록 변경 알림을 켠다. 이미 켜져 있으면 건너뛴다.

do $blk$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'care_logs') then
    alter publication supabase_realtime add table public.care_logs;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'care_events') then
    alter publication supabase_realtime add table public.care_events;
  end if;
exception when others then
  raise notice '실시간 알림은 켜지 못했습니다 (앱은 1분마다 새로 읽으므로 그대로 쓸 수 있습니다): %', sqlerrm;
end $blk$;
