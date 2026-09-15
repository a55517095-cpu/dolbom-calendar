import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import {
  SheetNotConnected, createCareLog, createEvent, deleteCareLog, deleteEvent, fetchDayNotes, fetchJournal,
  fetchMembers, fetchPosts, fetchShifts, friendlyError, getSheetUrl, saveMenus, saveSheetUrl,
  updateCareLog, updateEvent,
} from '../lib/api'
import { currentYearMonth, monthRange } from '../lib/date'
import { DEMO, demoSession, demoSource, type DataSource } from '../lib/demo'
import { DEFAULT_MENUS, EVENT, isLineMenu, normalizeMenus } from '../lib/menus'
import { readStored, writeStored } from '../lib/storage'
import type {
  CareDraft, CareLog, DayNote, EventDraft, EventItem, Member, Menu, Post, Shift,
} from '../lib/types'

type Ctx = {
  session: Session | null
  me: Member | null
  ready: boolean

  year: number
  month: number
  setMonth: (year: number, month: number) => void

  /** 로그인한 사람(김태순 님)의 근무 (Supabase) */
  shifts: Shift[]
  dayNotes: DayNote[]
  /** 돌봄 일지 · 한 줄 일정 · 메뉴 (구글시트) */
  careLogs: CareLog[]
  events: EventItem[]
  menus: Menu[]
  /** 일정이 속한 한 줄 메뉴 (지워졌으면 기본 「일정」) */
  lineMenuOf: (menuId: string) => Menu
  colorOf: (menuId: string) => string

  /** 구글시트 연결 주소가 아직 없다 */
  sheetMissing: boolean
  sheetUrl: string
  setSheetUrl: (url: string) => void
  /** 구글시트 스크립트에 AI 키가 연결돼 있어 말로 채우기가 칸별로 정리된다 */
  aiConnected: boolean
  setAiConnected: (connected: boolean) => void

  loading: boolean
  error: string | null
  refresh: () => Promise<void>

  postName: (id: string) => string

  saveCare: (draft: CareDraft, id?: string) => Promise<void>
  removeCare: (id: string) => Promise<void>
  saveEvent: (draft: EventDraft, id?: string) => Promise<void>
  removeEvent: (id: string) => Promise<void>
  saveMenus: (menus: Menu[]) => Promise<void>

  toast: string | null
  showToast: (message: string) => void
  signOut: () => Promise<void>
}

const AppContext = createContext<Ctx | null>(null)

export function useApp(): Ctx {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('AppProvider 안에서만 사용할 수 있습니다.')
  return ctx
}

/** 구글시트는 바뀌어도 알려주지 않으므로, 화면을 보고 있는 동안 이 간격으로 새로 읽는다 */
const POLL_MS = 60_000

/** 실제 데이터(근무: Supabase, 일지 · 일정 · 메뉴: 구글시트) · 체험 화면(?demo)이면 예시 데이터 */
const source: DataSource = DEMO ? demoSource : {
  fetchMembers, fetchPosts, fetchShifts, fetchDayNotes, fetchJournal,
  createCareLog, updateCareLog, deleteCareLog, createEvent, updateEvent, deleteEvent, saveMenus,
}

/** 메뉴 색이 불러오는 동안 기본색으로 깜빡이지 않게 마지막 메뉴를 기억해 둔다 */
const MENUS_CACHE_KEY = DEMO ? 'care-cal-menus-cache-demo' : 'care-cal-menus-cache'

function cachedMenus(): Menu[] {
  try {
    return normalizeMenus(JSON.parse(readStored(MENUS_CACHE_KEY) || 'null'))
  } catch {
    return DEFAULT_MENUS
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [me, setMe] = useState<Member | null>(null)
  const [ready, setReady] = useState(false)
  const [posts, setPosts] = useState<Post[]>([])

  const initial = currentYearMonth()
  const [year, setYear] = useState(initial.year)
  const [month, setMonthState] = useState(initial.month)

  const [shifts, setShifts] = useState<Shift[]>([])
  const [dayNotes, setDayNotes] = useState<DayNote[]>([])
  const [careLogs, setCareLogs] = useState<CareLog[]>([])
  const [events, setEvents] = useState<EventItem[]>([])
  const [menus, setMenusState] = useState<Menu[]>(cachedMenus)
  const [sheetMissing, setSheetMissing] = useState(false)
  const [sheetUrl, setSheetUrlState] = useState(getSheetUrl)
  const [aiConnected, setAiConnected] = useState(false)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)
  const requestSeq = useRef(0)

  const showToast = useCallback((message: string) => {
    setToast(message)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2800)
  }, [])

  const applyMenus = useCallback((next: Menu[]) => {
    setMenusState(next)
    writeStored(MENUS_CACHE_KEY, JSON.stringify(next))
  }, [])

  // ─── 로그인 상태 ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (DEMO) { setSession(demoSession); return }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (!data.session) setReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      if (!next) {
        setMe(null)
        setShifts([]); setDayNotes([]); setCareLogs([]); setEvents([])
        setReady(true)
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  // ─── 로그인 후 기준 데이터 ────────────────────────────────────────────────

  const loadBase = useCallback(async () => {
    if (!session) return
    try {
      const [m, p] = await Promise.all([source.fetchMembers(), source.fetchPosts()])
      setPosts(p)
      setMe(m.find((x) => x.auth_user_id === session.user.id) ?? null)
      setError(null)
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setReady(true)
    }
  }, [session])

  useEffect(() => { void loadBase() }, [loadBase])

  // ─── 그 달의 근무 · 일지 · 일정 ───────────────────────────────────────────

  const meId = me?.id
  const loadMonth = useCallback(async () => {
    if (!session || !meId) return
    const seq = ++requestSeq.current
    setLoading(true)
    const { from, to } = monthRange(year, month)
    const [sh, notes, journal] = await Promise.allSettled([
      source.fetchShifts(meId, from, to),
      source.fetchDayNotes(from, to),
      source.fetchJournal(from, to),
    ])
    // 달을 빠르게 넘기면 늦게 도착한 옛 응답이 새 달을 덮어쓰지 않게 한다
    if (seq !== requestSeq.current) return

    if (sh.status === 'fulfilled') setShifts(sh.value)
    if (notes.status === 'fulfilled') setDayNotes(notes.value)
    const notConnected = journal.status === 'rejected' && journal.reason instanceof SheetNotConnected
    setSheetMissing(notConnected)
    if (journal.status === 'fulfilled') {
      setCareLogs(journal.value.care)
      setEvents(journal.value.events)
      applyMenus(journal.value.menus)
      setAiConnected(Boolean(journal.value.aiConnected))
    } else if (notConnected) {
      setCareLogs([])
      setEvents([])
      setAiConnected(false)
    }

    const failed = [sh, notes, journal].find(
      (r): r is PromiseRejectedResult => r.status === 'rejected' && !(r === journal && notConnected),
    )
    setError(failed ? friendlyError(failed.reason) : null)
    setLoading(false)
    // sheetUrl 이 바뀌면(설정에서 연결) 다시 불러온다
  }, [session, meId, year, month, sheetUrl, applyMenus]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void loadMonth() }, [loadMonth])

  // ─── 최신으로 유지 ────────────────────────────────────────────────────────
  // 근무표 앱에서 교대하면 바로, 다른 기기(PC ↔ 휴대폰)에서 쓴 기록은
  // 창으로 돌아올 때 또는 1분 안에 반영된다.

  useEffect(() => {
    if (!session || DEMO) return
    let timer: number | undefined
    const nudge = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => { void loadMonth() }, 400)
    }
    const channel = supabase
      .channel('care-calendar-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shifts' }, nudge)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'schedules' }, nudge)
      .subscribe()
    return () => {
      window.clearTimeout(timer)
      void supabase.removeChannel(channel)
    }
  }, [session, loadMonth])

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') void loadMonth() }
    const poll = window.setInterval(onVisible, POLL_MS)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      window.clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [loadMonth])

  const postIndex = useMemo(() => new Map(posts.map((p) => [p.id, p.name])), [posts])
  const menuIndex = useMemo(() => new Map(menus.map((m) => [m.id, m])), [menus])

  const lineMenuOf = useCallback((menuId: string) => {
    const m = menuIndex.get(menuId)
    return m && isLineMenu(m.id) ? m : (menuIndex.get(EVENT) ?? DEFAULT_MENUS[2])
  }, [menuIndex])

  const colorOf = useCallback(
    (menuId: string) => menuIndex.get(menuId)?.color ?? DEFAULT_MENUS[2].color,
    [menuIndex],
  )

  const value: Ctx = {
    session, me, ready,
    year, month,
    setMonth: (y, m) => { setYear(y); setMonthState(m) },
    shifts, dayNotes, careLogs, events, menus, lineMenuOf, colorOf,
    sheetMissing, sheetUrl, aiConnected, setAiConnected,
    setSheetUrl: (url) => { saveSheetUrl(url); setSheetUrlState(getSheetUrl()) },
    loading, error,
    refresh: async () => { await loadBase(); await loadMonth() },
    postName: (id) => postIndex.get(id) ?? '근무',
    saveCare: async (draft, id) => {
      if (id) await source.updateCareLog(id, draft)
      else await source.createCareLog(draft)
      await loadMonth()
      showToast(id ? '일지를 고쳤습니다.' : '일지를 저장했습니다.')
    },
    removeCare: async (id) => {
      await source.deleteCareLog(id)
      await loadMonth()
      showToast('일지를 지웠습니다.')
    },
    saveEvent: async (draft, id) => {
      if (id) await source.updateEvent(id, draft)
      else await source.createEvent(draft)
      await loadMonth()
      showToast(id ? '일정을 고쳤습니다.' : '일정을 추가했습니다.')
    },
    removeEvent: async (id) => {
      await source.deleteEvent(id)
      await loadMonth()
      showToast('일정을 지웠습니다.')
    },
    saveMenus: async (next) => {
      await source.saveMenus(next)
      applyMenus(normalizeMenus(next))
      await loadMonth()
      showToast('메뉴를 저장했습니다.')
    },
    toast, showToast,
    signOut: async () => {
      if (DEMO) window.location.href = window.location.pathname
      else await supabase.auth.signOut()
    },
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}
