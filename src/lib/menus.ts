import type { CareLog, EventItem, Menu, Shift } from './types'

/** 고정 메뉴: 돌봄(일지) · 근무(해설사 근무표) · 일정(한 줄 일정의 기본 메뉴) */
export const CARE = 'care'
export const WORK = 'work'
export const EVENT = 'event'

export const DEFAULT_MENUS: Menu[] = [
  { id: CARE, name: '돌봄', color: '#3b7154' },
  { id: WORK, name: '근무', color: '#2b4983' },
  { id: EVENT, name: '일정', color: '#b7791f' },
]

/** 색 고르기에 먼저 보여줄 색 (직접 고를 수도 있다) */
export const PALETTE = [
  '#3b7154', '#2b4983', '#b7791f', '#c1461d', '#7a4a8c',
  '#2a7a7a', '#b8456b', '#6b7a2a', '#8a5a3b', '#56606b',
]

export const MENU_NAME_MAX = 10

export const isFixedMenu = (id: string) => id === CARE || id === WORK || id === EVENT

/** 한 줄 일정으로 기록하는 메뉴 (돌봄 · 근무를 뺀 전부) */
export const isLineMenu = (id: string) => id !== CARE && id !== WORK

const validColor = (c: unknown) =>
  typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : undefined

/** 고정 메뉴가 빠져 있으면 채우고, 순서를 돌봄 · 근무 · 일정 · 추가한 메뉴로 맞춘다 */
export function normalizeMenus(menus: Menu[] | null | undefined): Menu[] {
  const list = Array.isArray(menus) ? menus : []
  const byId = new Map(list.map((m) => [m.id, m]))
  const fixed = DEFAULT_MENUS.map((d) => ({ ...d, color: validColor(byId.get(d.id)?.color) ?? d.color }))
  const extra = list
    .filter((m) => m && !isFixedMenu(m.id) && m.name?.trim())
    .map((m) => ({ id: m.id, name: m.name.trim(), color: validColor(m.color) ?? PALETTE[3] }))
  return [...fixed, ...extra]
}

export const newMenuId = () => `m-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

export const byEventTime = (a: EventItem, b: EventItem) =>
  a.date.localeCompare(b.date) ||
  (a.time || '99').localeCompare(b.time || '99') ||
  (a.created_at || '').localeCompare(b.created_at || '')

/** 상단에서 끈 메뉴를 빼고 그 날 보여줄 것 (캘린더 · 모아보기 공통) */
export function pickVisible(
  hidden: ReadonlySet<string>,
  shift: Shift | undefined,
  cares: CareLog[],
  events: EventItem[],
  lineMenuOf: (menuId: string) => Menu,
) {
  return {
    shift: hidden.has(WORK) ? undefined : shift,
    cares: hidden.has(CARE) ? [] : cares,
    events: events.filter((e) => !hidden.has(lineMenuOf(e.menu_id).id)),
  }
}
