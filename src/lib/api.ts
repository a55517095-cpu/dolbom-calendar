import { supabase } from './supabase'
import { readStored, writeStored } from './storage'
import { byEventTime, normalizeMenus } from './menus'
import type {
  CareDraft, CareLog, DayNote, EventDraft, EventItem, JournalMonth, Member, Menu, Post, PublicMember, Shift,
} from './types'

type PgError = { message?: string; code?: string }

/** 서버에서 온 오류를 사람이 읽을 수 있는 한국어 한 줄로 */
export function friendlyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : (err as PgError | null)?.message ?? String(err ?? '')
  if (!raw) return '알 수 없는 오류가 생겼습니다.'
  if (raw.includes('Invalid login credentials')) return 'PIN이 맞지 않습니다. 다시 확인해 주세요.'
  if (raw.includes('Failed to fetch') || raw.includes('NetworkError'))
    return '인터넷 연결을 확인해 주세요.'
  if (raw.includes('JWT')) return '로그인이 만료되었습니다. 다시 로그인해 주세요.'
  if (isStoreMissing(err)) return STORE_MISSING_MESSAGE
  if (raw.includes('row-level security')) return '이 기록을 쓸 권한이 없습니다. 근무표 명단에 연결된 계정으로 로그인했는지 확인해 주세요.'
  return raw
}

// ─── 해설사 근무표 (Supabase · 읽기만) ────────────────────────────────────────

/** 로그인 화면용 - 로그인 전에도 읽을 수 있는 공개 명단에서 한 사람 */
export async function fetchPublicMemberByName(name: string): Promise<PublicMember | null> {
  const { data, error } = await supabase
    .from('public_members').select('id, name, login_code').eq('name', name).limit(1)
  if (error) throw error
  return data?.[0] ?? null
}

export async function fetchMembers(): Promise<Member[]> {
  const { data, error } = await supabase
    .from('members').select('id, auth_user_id, login_code, name, role, active').order('name')
  if (error) throw error
  return data ?? []
}

export async function fetchPosts(): Promise<Post[]> {
  const { data, error } = await supabase.from('posts').select('*').order('sort_order')
  if (error) throw error
  return data ?? []
}

/** 한 사람의 기간 내 근무 */
export async function fetchShifts(memberId: string, from: string, to: string): Promise<Shift[]> {
  const { data, error } = await supabase
    .from('shifts')
    .select('id, schedule_id, work_date, post_id, member_id, is_closed, changed')
    .eq('member_id', memberId)
    .gte('work_date', from)
    .lte('work_date', to)
    .order('work_date')
  if (error) throw error
  return data ?? []
}

/** 날짜별 안내 메모 (특별탐방 등) */
export async function fetchDayNotes(from: string, to: string): Promise<DayNote[]> {
  const { data, error } = await supabase
    .from('day_notes').select('*').gte('work_date', from).lte('work_date', to)
  if (error) throw error
  return data ?? []
}

// ─── 돌봄 일지 · 일정 · 메뉴 (Supabase · supabase/care_journal.sql) ──────────
// 근무표와 같은 Supabase 프로젝트의 care_logs · care_events · care_menus 표에 저장한다.
// 행 수준 보안으로 본인 것만 읽고 쓴다. owner_id 는 서버가 로그인한 사람으로 채운다.

/** 일지 표가 아직 없다 (supabase/care_journal.sql 을 실행하지 않았다) */
export class StoreMissing extends Error {}

export const STORE_MISSING_MESSAGE =
  '돌봄 일지를 저장할 표가 Supabase 에 아직 없습니다. README 「1. Supabase 표 만들기」대로 supabase/care_journal.sql 을 실행해 주세요.'

/** 표가 없을 때 PostgREST 가 내는 오류 (42P01 = relation does not exist, PGRST205 = 스키마 캐시에 없음) */
export function isStoreMissing(err: unknown): boolean {
  const e = err as PgError | null
  const code = e?.code ?? ''
  const msg = e?.message ?? ''
  return code === '42P01' || code === 'PGRST205' || /relation .*care_/.test(msg) || /Could not find the table 'public\.care_/.test(msg)
}

function fail(error: PgError): never {
  if (isStoreMissing(error)) throw new StoreMissing(STORE_MISSING_MESSAGE)
  throw error
}

export const byTime = (a: CareLog, b: CareLog) =>
  a.log_date.localeCompare(b.log_date) ||
  (a.created_at || '').localeCompare(b.created_at || '')

const CARE_COLUMNS = 'id, log_date, client_name, work_done, special_note, created_at, updated_at'
const EVENT_COLUMNS = 'id, event_date, event_time, menu_id, body, created_at, updated_at'

type EventRow = {
  id: string; event_date: string; event_time: string | null; menu_id: string; body: string
  created_at: string; updated_at: string
}

const toEvent = (r: EventRow): EventItem => ({
  id: r.id, date: r.event_date, time: r.event_time, menu_id: r.menu_id, text: r.body,
  created_at: r.created_at, updated_at: r.updated_at,
})

const careFromDraft = (d: CareDraft) => ({
  log_date: d.log_date,
  client_name: d.client_name.trim() || null,
  work_done: d.work_done.trim(),
  special_note: d.special_note.trim() || null,
})

const eventFromDraft = (d: EventDraft) => ({
  event_date: d.date,
  event_time: d.time || null,
  menu_id: d.menu_id,
  body: d.text.replace(/\s+/g, ' ').trim().slice(0, 100),
})

/** 한 달치 돌봄 일지 · 일정 · 메뉴를 한 번에 (세 표를 동시에 읽는다) */
export async function fetchJournal(from: string, to: string): Promise<JournalMonth> {
  const [care, events, menus] = await Promise.all([
    supabase.from('care_logs').select(CARE_COLUMNS).gte('log_date', from).lte('log_date', to),
    supabase.from('care_events').select(EVENT_COLUMNS).gte('event_date', from).lte('event_date', to),
    supabase.from('care_menus').select('id, name, color').order('sort_order'),
  ])
  if (care.error) fail(care.error)
  if (events.error) fail(events.error)
  if (menus.error) fail(menus.error)
  return {
    care: ((care.data ?? []) as CareLog[]).sort(byTime),
    events: ((events.data ?? []) as EventRow[]).map(toEvent).sort(byEventTime),
    menus: normalizeMenus(menus.data ?? []),
  }
}

/** 저장한 줄을 돌려받아 화면에 바로 반영한다 */
export async function createCareLog(draft: CareDraft): Promise<CareLog> {
  const { data, error } = await supabase.from('care_logs').insert(careFromDraft(draft)).select(CARE_COLUMNS).single()
  if (error) fail(error)
  return data as CareLog
}

export async function updateCareLog(id: string, draft: CareDraft): Promise<CareLog> {
  const { data, error } = await supabase.from('care_logs').update(careFromDraft(draft)).eq('id', id).select(CARE_COLUMNS).maybeSingle()
  if (error) fail(error)
  if (!data) throw new Error('일지를 찾을 수 없습니다. 다른 기기에서 지워졌을 수 있습니다.')
  return data as CareLog
}

export async function deleteCareLog(id: string): Promise<void> {
  const { error } = await supabase.from('care_logs').delete().eq('id', id)
  if (error) fail(error)
}

export async function createEvent(draft: EventDraft): Promise<EventItem> {
  const { data, error } = await supabase.from('care_events').insert(eventFromDraft(draft)).select(EVENT_COLUMNS).single()
  if (error) fail(error)
  return toEvent(data as EventRow)
}

export async function updateEvent(id: string, draft: EventDraft): Promise<EventItem> {
  const { data, error } = await supabase.from('care_events').update(eventFromDraft(draft)).eq('id', id).select(EVENT_COLUMNS).maybeSingle()
  if (error) fail(error)
  if (!data) throw new Error('일정을 찾을 수 없습니다. 다른 기기에서 지워졌을 수 있습니다.')
  return toEvent(data as EventRow)
}

export async function deleteEvent(id: string): Promise<void> {
  const { error } = await supabase.from('care_events').delete().eq('id', id)
  if (error) fail(error)
}

/** 메뉴 목록을 통째로 저장한다 (지운 메뉴의 일정은 서버가 「일정」으로 옮긴다) */
export async function saveMenus(menus: Menu[]): Promise<void> {
  const { error } = await supabase.rpc('save_care_menus', { p_menus: normalizeMenus(menus) })
  if (error) fail(error)
}

export type StoreStatus = { count: number; events: number }

/** 설정 화면의 저장소 확인 (표가 있는지 · 몇 건 있는지) */
export async function pingStore(): Promise<StoreStatus> {
  const [care, events] = await Promise.all([
    supabase.from('care_logs').select('id', { count: 'exact', head: true }),
    supabase.from('care_events').select('id', { count: 'exact', head: true }),
  ])
  if (care.error) fail(care.error)
  if (events.error) fail(events.error)
  return { count: care.count ?? 0, events: events.count ?? 0 }
}

// ─── 백업 (CSV) ─────────────────────────────────────────────────────────────

const csvCell = (v: string | null | undefined) => {
  const s = v == null ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** 모든 일지와 일정을 CSV 글자로 (엑셀 · 구글시트에서 바로 열린다) */
export async function exportCsv(): Promise<string> {
  const [care, events, menus] = await Promise.all([
    supabase.from('care_logs').select(CARE_COLUMNS).order('log_date'),
    supabase.from('care_events').select(EVENT_COLUMNS).order('event_date'),
    supabase.from('care_menus').select('id, name, color').order('sort_order'),
  ])
  if (care.error) fail(care.error)
  if (events.error) fail(events.error)
  if (menus.error) fail(menus.error)
  const menuName = new Map(normalizeMenus(menus.data ?? []).map((m) => [m.id, m.name]))
  const lines: string[] = ['﻿구분,날짜,시각,장소 / 메뉴,한 일 / 내용,특이사항,작성 시각,수정 시각']
  for (const r of (care.data ?? []) as CareLog[]) {
    lines.push(['돌봄일지', r.log_date, '', r.client_name, r.work_done, r.special_note, r.created_at, r.updated_at].map(csvCell).join(','))
  }
  for (const r of (events.data ?? []) as EventRow[]) {
    lines.push(['일정', r.event_date, r.event_time, menuName.get(r.menu_id) ?? '일정', r.body, '', r.created_at, r.updated_at].map(csvCell).join(','))
  }
  return lines.join('\r\n')
}

// ─── 예전 구글시트에서 가져오기 (한 번만) ─────────────────────────────────────
// 전에 구글시트(Apps Script 웹 앱)에 저장했던 기록을 Supabase 로 옮긴다.
// 구글시트 스크립트(google-apps-script/Code.gs)의 list 요청을 그대로 써서 읽는다.

const SHEET_URL_KEY = 'care-cal-sheet-url'

export const getSheetUrl = (): string => (readStored(SHEET_URL_KEY) || import.meta.env.VITE_SHEET_API_URL || '').trim()
export const saveSheetUrl = (url: string): void => writeStored(SHEET_URL_KEY, url.trim())

export const looksLikeSheetUrl = (url: string) =>
  /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url.trim())

type SheetJournal = { rows: CareLog[]; events: EventItem[]; menus: Menu[] }

async function readSheet(url: string): Promise<SheetJournal> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('로그인이 만료되었습니다. 다시 로그인해 주세요.')
  let text: string
  try {
    const res = await fetch(url, { method: 'POST', body: JSON.stringify({ action: 'list', token, from: '2000-01-01', to: '2100-12-31' }) })
    text = await res.text()
  } catch {
    throw new Error('구글시트에 연결하지 못했습니다. 인터넷 연결과 웹 앱 주소를 확인해 주세요.')
  }
  let body: { ok?: boolean; error?: string; rows?: CareLog[]; events?: EventItem[]; menus?: Menu[] }
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error('구글시트 응답을 읽지 못했습니다. 연결 주소가 웹 앱 주소(…/exec)가 맞는지 확인해 주세요.')
  }
  if (!body.ok) throw new Error(body.error || '구글시트 처리 중 오류가 생겼습니다.')
  return { rows: body.rows ?? [], events: body.events ?? [], menus: normalizeMenus(body.menus) }
}

export type ImportResult = { care: number; events: number; menus: number }

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)

/** 구글시트가 붙인 id 는 UUID 라 그대로 쓰고, 모양이 다르면 새로 만든다 (한 번에 넣는 줄은 모두 같은 열을 가져야 한다) */
function importId(id: string): string {
  if (isUuid(id)) return id.toLowerCase()
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16)
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

const importStamp = (s: string | undefined) => (s && !Number.isNaN(Date.parse(s)) ? new Date(s).toISOString() : new Date().toISOString())

/** 구글시트의 기록을 Supabase 로 복사한다. 같은 id 의 기록은 건너뛰므로 여러 번 눌러도 겹치지 않는다 */
export async function importFromSheet(url: string): Promise<ImportResult> {
  const sheet = await readSheet(url)
  const careRows = sheet.rows
    .filter((r) => r.log_date && r.work_done)
    .map((r) => ({
      id: importId(r.id),
      ...careFromDraft({
        log_date: r.log_date, client_name: r.client_name ?? '',
        work_done: r.work_done, special_note: r.special_note ?? '',
      }),
      created_at: importStamp(r.created_at),
    }))
  const eventRows = sheet.events
    .filter((e) => e.date && e.text)
    .map((e) => ({
      id: importId(e.id),
      ...eventFromDraft({ date: e.date, time: e.time ?? '', menu_id: e.menu_id, text: e.text }),
      created_at: importStamp(e.created_at),
    }))

  // 메뉴를 먼저 (일정의 메뉴 id 가 살아 있도록)
  await saveMenus(sheet.menus)
  if (careRows.length) {
    const { error } = await supabase.from('care_logs').upsert(careRows, { onConflict: 'id', ignoreDuplicates: true })
    if (error) fail(error)
  }
  if (eventRows.length) {
    const { error } = await supabase.from('care_events').upsert(eventRows, { onConflict: 'id', ignoreDuplicates: true })
    if (error) fail(error)
  }
  return { care: careRows.length, events: eventRows.length, menus: sheet.menus.length }
}
