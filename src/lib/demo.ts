import type { Session } from '@supabase/supabase-js'
import { byTime } from './api'
import { fromISODate, toISODate, todayISO } from './date'
import { DEFAULT_MENUS, EVENT, byEventTime, isLineMenu, normalizeMenus } from './menus'
import { readStored, writeStored } from './storage'
import type {
  CareDraft, CareLog, DayNote, EventDraft, EventItem, JournalMonth, Member, Menu, Post, Shift,
} from './types'

/**
 * 체험 화면 (주소 끝에 ?demo)
 * 로그인 · 구글시트 연결 없이, 입력한 내용이 캘린더에 어떻게 보이는지 확인하는 용도.
 * 근무 · 일지 · 일정은 예시이고, 입력한 내용은 이 브라우저에만 임시로 저장된다.
 */
export const DEMO = new URLSearchParams(window.location.search).has('demo')

/** 앱이 쓰는 데이터 창구 — 실제(Supabase + 구글시트)와 체험이 같은 모양 */
export type DataSource = {
  fetchMembers(): Promise<Member[]>
  fetchPosts(): Promise<Post[]>
  fetchShifts(memberId: string, from: string, to: string): Promise<Shift[]>
  fetchDayNotes(from: string, to: string): Promise<DayNote[]>
  fetchJournal(from: string, to: string): Promise<JournalMonth>
  /** 저장한 줄을 돌려준다 (예전 구글시트 스크립트처럼 돌려주지 못하면 null) */
  createCareLog(draft: CareDraft): Promise<CareLog | null>
  updateCareLog(id: string, draft: CareDraft): Promise<CareLog | null>
  deleteCareLog(id: string): Promise<void>
  createEvent(draft: EventDraft): Promise<EventItem | null>
  updateEvent(id: string, draft: EventDraft): Promise<EventItem | null>
  deleteEvent(id: string): Promise<void>
  saveMenus(menus: Menu[]): Promise<void>
}

const ME: Member = {
  id: 'demo-member', auth_user_id: 'demo-user', login_code: 'demo', name: '권희', role: 'member', active: true,
}

export const demoSession = {
  access_token: 'demo',
  user: { id: 'demo-user', email: '체험 화면 (로그인 없음)' },
} as unknown as Session

const POSTS: Post[] = ['시공원', '기당미술관', '소암기념관', '서복전시관']
  .map((name, i) => ({ id: `demo-post-${i}`, name, sort_order: i, active: true }))

/** 달마다 같은 날짜에 예시 근무 */
const SHIFT_DAYS = [2, 5, 9, 13, 16, 19, 23, 27, 30]

const pad = (n: number) => String(n).padStart(2, '0')

const addDays = (iso: string, n: number) => {
  const d = fromISODate(iso)
  d.setDate(d.getDate() + n)
  return toISODate(d)
}

// http 주소(보안 연결 아님)에서는 crypto.randomUUID 가 없어서 직접 만든다
const newId = () => `demo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const HOSPITAL = 'demo-hospital'

/** 오늘을 기준으로 앞뒤 2주에 예시 기록 */
function seedCare(): CareLog[] {
  const today = todayISO()
  const log = (offset: number, work: string, extra: Partial<CareLog> = {}): CareLog => {
    const date = addDays(today, offset)
    return {
      id: newId(), log_date: date, client_name: null,
      work_done: work, special_note: null,
      created_at: `${date}T09:00:00.000Z`, updated_at: `${date}T09:00:00.000Z`,
      ...extra,
    }
  }
  return [
    log(-13, '책 고르는 것 도움, 독후감 숙제 봐 줌', { client_name: '문고, 중앙도서관' }),
    log(-11, '하교 동행, 간식 챙겨 줌'),
    log(-11, '숙제 봐 줌'),
    log(-7, '병원 동행 (정형외과)', {
      client_name: '○○정형외과',
      special_note: '오른쪽 발목 통증 — 보호자에게 전달함',
    }),
    log(-5, '학교 준비물 함께 챙김'),
    log(-5, '장보기 동행', { client_name: '마트' }),
    log(-5, '놀이터에서 놀이 지켜봄', { client_name: '놀이터' }),
    log(-1, '간식 챙겨 줌', { special_note: '기운이 없어 보임 — 낮잠을 오래 잠' }),
  ]
}

function seedEvents(): EventItem[] {
  const today = todayISO()
  const item = (offset: number, time: string | null, text: string, menu_id = EVENT): EventItem => {
    const date = addDays(today, offset)
    return { id: newId(), date, time, menu_id, text, created_at: `${date}T08:00:00.000Z`, updated_at: `${date}T08:00:00.000Z` }
  }
  return [
    item(-6, '09:00', '해설사 교육 (시청 2층)'),
    item(-3, '14:00', '보호자 상담 전화'),
    item(0, '18:30', '가족 저녁 모임'),
    item(1, '10:00', '정형외과 진료 예약 (동하)', HOSPITAL),
    item(3, null, '장보기 목록 확인'),
    item(8, '11:00', '치과 정기검진', HOSPITAL),
  ]
}

const seedMenus = (): Menu[] => [...DEFAULT_MENUS, { id: HOSPITAL, name: '병원', color: '#b8456b' }]

/** 브라우저 저장소에 두되, 저장이 막혀 있어도 이번 접속 동안은 기억하도록 메모리에도 둔다 */
function store<T>(key: string, seed: () => T) {
  let memory: T | null = null
  const save = (value: T): T => {
    memory = value
    writeStored(key, JSON.stringify(value))
    return value
  }
  const load = (): T => {
    if (memory) return memory
    try {
      const raw = readStored(key)
      if (raw) return (memory = JSON.parse(raw) as T)
    } catch {
      /* 깨진 값이면 예시로 새로 시작 */
    }
    return save(seed())
  }
  return { load, save, reset: () => save(seed()) }
}

const careStore = store('care-cal-demo-logs', seedCare)
const eventStore = store('care-cal-demo-events', seedEvents)
const menuStore = store('care-cal-demo-menus', seedMenus)

const careFromDraft = (d: CareDraft) => ({
  log_date: d.log_date,
  client_name: d.client_name.trim() || null,
  work_done: d.work_done.trim(),
  special_note: d.special_note.trim() || null,
})

const eventFromDraft = (d: EventDraft) => ({
  date: d.date,
  time: d.time || null,
  menu_id: d.menu_id,
  text: d.text.replace(/\s+/g, ' ').trim(),
})

export const demoSource: DataSource = {
  fetchMembers: async () => [ME],
  fetchPosts: async () => POSTS,
  fetchShifts: async (_memberId, from, to) => {
    const ym = from.slice(0, 7)
    const last = Number(to.slice(8, 10))
    return SHIFT_DAYS.filter((d) => d <= last).map((d, i) => ({
      id: `demo-shift-${ym}-${d}`,
      schedule_id: 'demo',
      work_date: `${ym}-${pad(d)}`,
      post_id: POSTS[i % POSTS.length].id,
      member_id: ME.id,
      is_closed: false,
      changed: i === 2,
    }))
  },
  fetchDayNotes: async (from) => [
    { id: 'demo-note', schedule_id: 'demo', work_date: `${from.slice(0, 7)}-19`, body: '특별탐방 오전 10시' },
  ],
  fetchJournal: async (from, to) => ({
    care: careStore.load().filter((c) => c.log_date >= from && c.log_date <= to).sort(byTime),
    events: eventStore.load().filter((e) => e.date >= from && e.date <= to).sort(byEventTime),
    menus: normalizeMenus(menuStore.load()),
  }),
  createCareLog: async (draft) => {
    const now = new Date().toISOString()
    const row: CareLog = { id: newId(), ...careFromDraft(draft), created_at: now, updated_at: now }
    careStore.save([...careStore.load(), row])
    return row
  },
  updateCareLog: async (id, draft) => {
    const now = new Date().toISOString()
    const list = careStore.save(careStore.load().map((c) => (c.id === id ? { ...c, ...careFromDraft(draft), updated_at: now } : c)))
    return list.find((c) => c.id === id) ?? null
  },
  deleteCareLog: async (id) => {
    careStore.save(careStore.load().filter((c) => c.id !== id))
  },
  createEvent: async (draft) => {
    const now = new Date().toISOString()
    const item: EventItem = { id: newId(), ...eventFromDraft(draft), created_at: now, updated_at: now }
    eventStore.save([...eventStore.load(), item])
    return item
  },
  updateEvent: async (id, draft) => {
    const now = new Date().toISOString()
    const list = eventStore.save(eventStore.load().map((e) => (e.id === id ? { ...e, ...eventFromDraft(draft), updated_at: now } : e)))
    return list.find((e) => e.id === id) ?? null
  },
  deleteEvent: async (id) => {
    eventStore.save(eventStore.load().filter((e) => e.id !== id))
  },
  saveMenus: async (menus) => {
    const list = menuStore.save(normalizeMenus(menus))
    // 지운 메뉴의 일정은 기본 「일정」으로 옮긴다 (구글시트와 같은 규칙)
    const lineIds = new Set(list.filter((m) => isLineMenu(m.id)).map((m) => m.id))
    eventStore.save(eventStore.load().map((e) => (lineIds.has(e.menu_id) ? e : { ...e, menu_id: EVENT })))
  },
}

/** 체험 화면의 기록과 메뉴를 처음 예시로 되돌린다 */
export function resetDemo(): void {
  careStore.reset()
  eventStore.reset()
  menuStore.reset()
}
