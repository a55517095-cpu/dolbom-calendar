import type { CareLog } from './types'

/**
 * 한 달 돌봄 시간 — 월 90시간을 넘으면 추가 급여가 없으므로 남은 시간을 계산한다.
 *
 * - 시작 · 끝 시간이 모두 있고 끝이 더 늦은 일지만 센다.
 * - 같은 날 시간이 겹치는 일지는 겹친 부분을 한 번만 센다.
 */

/** 추가 급여가 나오는 한 달 돌봄 시간 한도 (분) */
export const MONTH_LIMIT_MIN = 90 * 60

export type Span = { date: string; start: number; end: number }

const toMin = (t: string | null | undefined): number | null => {
  const m = String(t ?? '').match(/^(\d{1,2}):(\d{2})/)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/** 날짜 · 시작 · 끝 → 시간 구간 (시간으로 칠 수 없으면 null) */
export function spanOf(date: string, start: string | null | undefined, end: string | null | undefined): Span | null {
  const s = toMin(start)
  const e = toMin(end)
  return s !== null && e !== null && e > s ? { date, start: s, end: e } : null
}

export const spanMinutes = (span: Span | null): number => (span ? span.end - span.start : 0)

/** 구간들의 합 (같은 날 겹친 부분은 한 번만) */
export function totalMinutes(spans: Span[]): number {
  const byDate = new Map<string, Span[]>()
  for (const span of spans) byDate.set(span.date, [...(byDate.get(span.date) ?? []), span])

  let total = 0
  for (const list of byDate.values()) {
    list.sort((a, b) => a.start - b.start)
    let from = list[0].start
    let to = list[0].end
    for (const { start, end } of list.slice(1)) {
      if (start > to) {
        total += to - from
        from = start
        to = end
      } else {
        to = Math.max(to, end)
      }
    }
    total += to - from
  }
  return total
}

export type MonthHours = {
  /** 이 달 돌봄 시간 (분) */
  minutes: number
  /** 90시간까지 남은 시간 (분, 넘었으면 0) */
  remaining: number
  /** 90시간을 넘은 시간 (분) */
  over: number
  /** 시간이 없어 합계에서 빠진 일지 수 */
  untimed: number
}

/** 한 달치 일지의 돌봄 시간. extra 는 아직 저장하지 않은 일지 (입력 화면 미리 보기) */
export function monthHours(
  logs: Pick<CareLog, 'log_date' | 'start_time' | 'end_time'>[],
  extra: Span[] = [],
): MonthHours {
  const spans: Span[] = []
  let untimed = 0
  for (const log of logs) {
    const span = spanOf(log.log_date, log.start_time, log.end_time)
    if (span) spans.push(span)
    else untimed++
  }
  const minutes = totalMinutes([...spans, ...extra])
  return {
    minutes,
    remaining: Math.max(0, MONTH_LIMIT_MIN - minutes),
    over: Math.max(0, minutes - MONTH_LIMIT_MIN),
    untimed,
  }
}

/** 450 → '7시간 30분', 60 → '1시간', 25 → '25분', 0 → '0시간' */
export function formatHM(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h && m) return `${h}시간 ${m}분`
  if (h) return `${h}시간`
  return m ? `${m}분` : '0시간'
}
