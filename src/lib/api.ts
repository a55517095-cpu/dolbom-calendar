import { supabase } from './supabase'
import { readStored, writeStored } from './storage'
import { byEventTime, normalizeMenus } from './menus'
import type {
  CareDraft, CareFields, CareLog, DayNote, EventDraft, EventItem, JournalMonth, Member, Menu, Post, PublicMember, Shift,
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

// ─── 돌봄 일지 · 일정 · 메뉴 (구글시트 · google-apps-script/Code.gs) ─────────

const SHEET_URL_KEY = 'care-cal-sheet-url'

/** 설정 화면에서 넣은 주소가 우선, 없으면 빌드할 때 넣은 주소 */
export function getSheetUrl(): string {
  return (readStored(SHEET_URL_KEY) || import.meta.env.VITE_SHEET_API_URL || '').trim()
}

export function saveSheetUrl(url: string): void {
  writeStored(SHEET_URL_KEY, url.trim())
}

export const looksLikeSheetUrl = (url: string) =>
  /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url.trim())

/** 구글시트 연결 주소가 아직 없다 */
export class SheetNotConnected extends Error {}

const OUTDATED_SCRIPT =
  '구글시트 스크립트가 예전 버전입니다. README 「구글시트 연결」대로 Code.gs 를 새로 붙여넣고 「새 버전」으로 다시 배포해 주세요.'

/** 구글 웹 앱은 가끔 JSON 대신 HTML 오류 페이지("Sorry, unable to open the file…")를 잠깐 돌려준다 → 잠시 뒤 다시 시도 */
const RETRY_DELAYS_MS = [700, 1800]
/**
 * 한 번 요청에 기다리는 최대 시간. 구글시트 스크립트는 보통 1~4초지만 처음 깨어날 때나 구글이 느릴 때 훨씬 길어지고,
 * AI 정리는 모델이 답하는 시간까지 더해진다. 너무 일찍 끊으면 "응답하지 않습니다"만 뜨고 서버는 계속 일하고 있으므로 넉넉히 기다린다.
 */
const TIMEOUT_MS: Record<string, number> = { voiceFill: 120_000, saveAiKey: 60_000 }
const READ_TIMEOUT_MS = 45_000
const WRITE_TIMEOUT_MS = 60_000
const WRITES = new Set(['create', 'update', 'delete', 'createEvent', 'updateEvent', 'deleteEvent', 'saveMenus', 'removeAiKey'])
const timeoutFor = (action: string) => TIMEOUT_MS[action] ?? (WRITES.has(action) ? WRITE_TIMEOUT_MS : READ_TIMEOUT_MS)

/** 같은 요청을 두 번 보내면 줄이 두 개 생길 수 있는 요청은 다시 시도하지 않는다 */
const NO_RETRY = new Set(['create', 'createEvent'])

/** 잠시 뒤 다시 보내도 되는 오류 (구글의 일시적 오류 페이지 · 연결 실패) */
class Transient extends Error {}

/** 시간이 너무 걸려 끊은 요청 — 서버는 아직 처리 중일 수 있으므로 자동으로 다시 보내지 않는다 */
function timedOut(action: string): Error {
  if (action === 'voiceFill') return new Error('AI 정리가 너무 오래 걸립니다. 잠시 뒤 「AI 로 정리」를 다시 눌러 주세요.')
  if (WRITES.has(action)) {
    return new Error('구글시트 응답이 너무 늦습니다. 저장됐을 수도 있으니 달력을 새로 고쳐 확인한 뒤 다시 시도해 주세요.')
  }
  return new Error('구글시트가 응답하지 않습니다. 잠시 뒤 다시 시도해 주세요.')
}

async function callSheet<T extends object = object>(
  action: string, payload: Record<string, unknown> = {},
): Promise<T> {
  const url = getSheetUrl()
  if (!url) throw new SheetNotConnected('구글시트가 아직 연결되지 않았습니다.')

  // 구글시트 쪽에서 김태순 님 로그인이 맞는지 확인할 수 있게 로그인 토큰을 함께 보낸다
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('로그인이 만료되었습니다. 다시 로그인해 주세요.')

  const body = JSON.stringify({ action, token, ...payload })
  const retries = NO_RETRY.has(action) ? 0 : RETRY_DELAYS_MS.length
  for (let attempt = 0; ; attempt++) {
    try {
      return await postSheet<T>(url, body, action)
    } catch (e) {
      if (!(e instanceof Transient) || attempt >= retries) throw e
      await new Promise((r) => window.setTimeout(r, RETRY_DELAYS_MS[attempt]))
    }
  }
}

async function postSheet<T extends object>(url: string, body: string, action: string): Promise<T> {
  const abort = new AbortController()
  const timer = window.setTimeout(() => abort.abort(), timeoutFor(action))
  let text: string
  try {
    // 본문을 문자열(text/plain)로 보내야 구글 웹 앱이 사전 확인 요청 없이 받아준다
    const res = await fetch(url, { method: 'POST', body, signal: abort.signal })
    text = await res.text()
  } catch {
    if (abort.signal.aborted) throw timedOut(action)
    throw new Transient('구글시트에 연결하지 못했습니다. 인터넷 연결과, 웹 앱 액세스 권한이 "모든 사용자"인지 확인해 주세요.')
  } finally {
    window.clearTimeout(timer)
  }

  let parsed: { ok?: boolean; error?: string }
  try {
    parsed = JSON.parse(text)
  } catch {
    // 구글이 잠깐 내는 HTML 오류 페이지인지, 주소가 틀린 것인지 구분한다
    const head = text.slice(0, 2000)
    if (/unable to open the file|try again|잠시 후|다시 시도/i.test(head)) {
      throw new Transient('구글시트가 잠시 응답하지 못했습니다. 잠시 뒤 다시 시도해 주세요.')
    }
    if (/<html|<!doctype/i.test(head)) {
      throw new Error(
        '구글시트 응답을 읽지 못했습니다. 연결 주소가 웹 앱 주소(…/exec)가 맞는지, 배포 액세스 권한이 "모든 사용자"인지 확인해 주세요.',
      )
    }
    throw new Transient('구글시트 응답을 읽지 못했습니다. 잠시 뒤 다시 시도해 주세요.')
  }
  if (!parsed.ok) {
    const message = parsed.error || '구글시트 처리 중 오류가 생겼습니다.'
    throw new Error(message === '알 수 없는 요청입니다.' ? OUTDATED_SCRIPT : message)
  }
  return parsed as unknown as T
}

export const byTime = (a: CareLog, b: CareLog) =>
  a.log_date.localeCompare(b.log_date) ||
  (a.start_time || '99').localeCompare(b.start_time || '99') ||
  (a.created_at || '').localeCompare(b.created_at || '')

/** 한 달치 돌봄 일지 · 일정 · 메뉴를 한 번에 */
export async function fetchJournal(from: string, to: string): Promise<JournalMonth> {
  const r = await callSheet<{
    rows: CareLog[]; events?: EventItem[]; menus?: Menu[]; ai?: { connected?: boolean }
  }>('list', { from, to })
  return {
    care: r.rows.sort(byTime),
    events: (r.events ?? []).sort(byEventTime),
    menus: normalizeMenus(r.menus),
    aiConnected: Boolean(r.ai?.connected),
  }
}

/** 저장한 줄을 돌려받아 화면에 바로 반영한다 (다시 불러올 때까지 기다리지 않아도 된다) */
export async function createCareLog(draft: CareDraft): Promise<CareLog | null> {
  const r = await callSheet<{ row?: CareLog }>('create', { draft })
  return r.row ?? null
}

export async function updateCareLog(id: string, draft: CareDraft): Promise<CareLog | null> {
  const r = await callSheet<{ row?: CareLog }>('update', { id, draft })
  return r.row ?? null
}

export async function deleteCareLog(id: string): Promise<void> {
  await callSheet('delete', { id })
}

export async function createEvent(draft: EventDraft): Promise<EventItem | null> {
  const r = await callSheet<{ event?: EventItem }>('createEvent', { draft })
  return r.event ?? null
}

export async function updateEvent(id: string, draft: EventDraft): Promise<EventItem | null> {
  const r = await callSheet<{ event?: EventItem }>('updateEvent', { id, draft })
  return r.event ?? null
}

export async function deleteEvent(id: string): Promise<void> {
  await callSheet('deleteEvent', { id })
}

export async function saveMenus(menus: Menu[]): Promise<void> {
  await callSheet('saveMenus', { menus })
}

export type SheetStatus = { sheet_url: string; count: number; events?: number }

/** 설정 화면의 연결 확인 */
export const pingSheet = () => callSheet<SheetStatus>('ping')

// ─── AI 연결 (말로 일지 채우기) ── API 키는 구글시트 스크립트에만 저장되고, 앱에는 끝 네 자리만 온다 ──

export type AiStatus = { connected: boolean; key_hint: string; model: string }

export const fetchAiStatus = () => callSheet<AiStatus>('aiStatus')

/** 구글시트 스크립트가 Anthropic 에 키를 확인한 뒤 저장한다 */
export const saveAiKey = (key: string) => callSheet<AiStatus>('saveAiKey', { key })

export const removeAiKey = () => callSheet<AiStatus>('removeAiKey')

/** 말한 내용을 AI 가 칸별로 정리한다 (new = 새로 쓰기, supplement = 지금 내용 보완) */
export async function voiceFillCare(
  transcript: string, draft: CareDraft, mode: 'new' | 'supplement',
): Promise<CareFields> {
  const r = await callSheet<{ fields: CareFields }>('voiceFill', { transcript, draft, mode })
  return r.fields
}
