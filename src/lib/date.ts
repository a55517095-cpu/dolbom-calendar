export const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'] as const

const pad = (n: number) => String(n).padStart(2, '0')

/** Date -> 'YYYY-MM-DD' (시간대 때문에 날짜가 하루 밀리는 것을 막기 위해 직접 만든다) */
export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 'YYYY-MM-DD' -> Date (현지 시각 자정) */
export function fromISODate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export const todayISO = () => toISODate(new Date())

export function weekdayOf(iso: string): number {
  return fromISODate(iso).getDay()
}

/** '9월 15일 (화)' */
export function formatDateKo(iso: string): string {
  const d = fromISODate(iso)
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAY_KO[d.getDay()]})`
}

/** 해당 월의 모든 날짜를 'YYYY-MM-DD' 로 */
export function daysInMonth(year: number, month: number): string[] {
  const last = new Date(year, month, 0).getDate()
  return Array.from({ length: last }, (_, i) => `${year}-${pad(month)}-${pad(i + 1)}`)
}

export function monthRange(year: number, month: number): { from: string; to: string } {
  const days = daysInMonth(year, month)
  return { from: days[0], to: days[days.length - 1] }
}

export function currentYearMonth(): { year: number; month: number } {
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() + 1 }
}

/** '오늘', '내일', '3일 전' */
export function relativeDayKo(iso: string): string {
  const diff = Math.round((fromISODate(iso).getTime() - fromISODate(todayISO()).getTime()) / 86_400_000)
  if (diff === 0) return '오늘'
  if (diff === 1) return '내일'
  if (diff === -1) return '어제'
  return diff > 0 ? `${diff}일 뒤` : `${-diff}일 전`
}

/** 'HH:MM:SS' -> 'HH:MM' */
export const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '')

/** '09:00–12:00', '09:00~', '~12:00' */
export function timeSpan(start: string | null, end: string | null): string {
  if (start && end) return `${hhmm(start)}–${hhmm(end)}`
  if (start) return `${hhmm(start)}~`
  if (end) return `~${hhmm(end)}`
  return ''
}
