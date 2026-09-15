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

async function callSheet<T extends object = object>(
  action: string, payload: Record<string, unknown> = {},
): Promise<T> {
  const url = getSheetUrl()
  if (!url) throw new SheetNotConnected('구글시트가 아직 연결되지 않았습니다.')

  // 구글시트 쪽에서 김태순 님 로그인이 맞는지 확인할 수 있게 로그인 토큰을 함께 보낸다
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('로그인이 만료되었습니다. 다시 로그인해 주세요.')

  let text: string
  try {
    // 본문을 문자열(text/plain)로 보내야 구글 웹 앱이 사전 확인 요청 없이 받아준다
    const res = await fetch(url, { method: 'POST', body: JSON.stringify({ action, token, ...payload }) })
    text = await res.text()
  } catch {
    throw new Error(
      '구글시트에 연결하지 못했습니다. 인터넷 연결과, 웹 앱 액세스 권한이 "모든 사용자"인지 확인해 주세요.',
    )
  }

  let body: { ok?: boolean; error?: string }
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error('구글시트 응답을 읽지 못했습니다. 연결 주소가 웹 앱 주소(…/exec)가 맞는지 확인해 주세요.')
  }
  if (!body.ok) {
    const message = body.error || '구글시트 처리 중 오류가 생겼습니다.'
    throw new Error(message === '알 수 없는 요청입니다.' ? OUTDATED_SCRIPT : message)
  }
  return body as unknown as T
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

export async function createCareLog(draft: CareDraft): Promise<void> {
  await callSheet('create', { draft })
}

export async function updateCareLog(id: string, draft: CareDraft): Promise<void> {
  await callSheet('update', { id, draft })
}

export async function deleteCareLog(id: string): Promise<void> {
  await callSheet('delete', { id })
}

export async function createEvent(draft: EventDraft): Promise<void> {
  await callSheet('createEvent', { draft })
}

export async function updateEvent(id: string, draft: EventDraft): Promise<void> {
  await callSheet('updateEvent', { id, draft })
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
