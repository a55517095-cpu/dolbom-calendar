import { useState, type SyntheticEvent } from 'react'
import { useApp } from '../state/AppContext'
import { WEEKDAY_KO, weekdayOf } from '../lib/date'
import { holidayName } from '../lib/holidays'
import { pickVisible } from '../lib/menus'
import { readStored, writeStored } from '../lib/storage'
import type { CareLog, EventItem, Shift } from '../lib/types'
import { CareCard, LineCard, WorkCard } from './Entries'

const OPEN_KEY = 'care-cal-ledger-open'

type Props = {
  days: string[]
  month: number
  hidden: ReadonlySet<string>
  shiftsByDate: Map<string, Shift>
  careByDate: Map<string, CareLog[]>
  eventsByDate: Map<string, EventItem[]>
  notesByDate: Map<string, string>
  onPick: (iso: string) => void
}

/** 캘린더와 같은 내용을 날짜순으로 끝까지 읽는 곳 */
export default function MonthList({
  days, month, hidden, shiftsByDate, careByDate, eventsByDate, notesByDate, onPick,
}: Props) {
  const { postName, menus, lineMenuOf } = useApp()

  const rows = days
    .map((iso) => ({
      iso,
      ...pickVisible(hidden, shiftsByDate.get(iso), careByDate.get(iso) ?? [], eventsByDate.get(iso) ?? [], lineMenuOf),
    }))
    .filter((r) => r.shift || r.cares.length > 0 || r.events.length > 0)

  const shown = menus.filter((m) => !hidden.has(m.id))
  const label = shown.length === menus.length ? '전체' : shown.map((m) => m.name).join(' · ') || '선택 없음'

  // 캘린더와 내용이 겹치므로 기본은 접어두고, 펼친 기기에서는 다음에도 펼친 채로 연다
  const [open, setOpen] = useState(() => readStored(OPEN_KEY) === '1')
  const toggle = (e: SyntheticEvent<HTMLDetailsElement>) => {
    const next = e.currentTarget.open
    setOpen(next)
    writeStored(OPEN_KEY, next ? '1' : '0')
  }

  return (
    <details className="ledger" open={open} onToggle={toggle}>
      <summary className="ledger-title">
        {month}월 기록 모아보기 <small>{label} · {rows.length}일</small>
        <span className="ledger-toggle" aria-hidden="true">{open ? '접기 ▲' : '펼치기 ▼'}</span>
      </summary>

      {!open ? null : rows.length === 0 ? (
        <p className="muted">이 달에는 표시할 기록이 없습니다.</p>
      ) : (
        rows.map(({ iso, shift, cares, events }) => {
          const w = weekdayOf(iso)
          const holiday = holidayName(iso)
          const tone = w === 0 || holiday ? ' sun' : w === 6 ? ' sat' : ''
          return (
            <div className="ledger-day" key={iso}>
              <button
                className={`ledger-date${tone}`}
                onClick={() => onPick(iso)}
                aria-label={`${month}월 ${Number(iso.slice(8, 10))}일 열기`}
              >
                <span className="d">{Number(iso.slice(8, 10))}</span>
                <span className="w">{WEEKDAY_KO[w]}</span>
                {holiday && <span className="h">{holiday}</span>}
              </button>
              <div className="ledger-items">
                {shift && (
                  <WorkCard shift={shift} place={postName(shift.post_id)} note={notesByDate.get(iso)} />
                )}
                {events.map((e) => <LineCard key={e.id} item={e} menu={lineMenuOf(e.menu_id)} />)}
                {cares.map((c) => <CareCard key={c.id} log={c} />)}
              </div>
            </div>
          )
        })
      )}
    </details>
  )
}
