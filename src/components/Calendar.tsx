import { useEffect, useRef, type CSSProperties, type KeyboardEvent } from 'react'
import { useApp } from '../state/AppContext'
import { WEEKDAY_KO, daysInMonth, formatDateKo, todayISO, weekdayOf } from '../lib/date'
import { holidayName } from '../lib/holidays'
import { pickVisible } from '../lib/menus'
import type { CareLog, EventItem, Menu, Shift } from '../lib/types'

type Props = {
  year: number
  month: number
  hidden: ReadonlySet<string>
  loading: boolean
  shiftsByDate: Map<string, Shift>
  careByDate: Map<string, CareLog[]>
  eventsByDate: Map<string, EventItem[]>
  notesByDate: Map<string, string>
  onPick: (iso: string) => void
}

/**
 * 월 캘린더. 날짜를 눌렀을 때 보이는 내용을 칸 안에 그대로 보여준다.
 * 근무 → 한 줄 일정 → 돌봄 일지(전체) 순서. 칸 높이는 내용에 맞춰 늘어나고,
 * 휴대폰에서는 달력을 좌우로 밀어서 본다.
 */
export default function Calendar({
  year, month, hidden, loading, shiftsByDate, careByDate, eventsByDate, notesByDate, onPick,
}: Props) {
  const { postName, lineMenuOf } = useApp()
  const scroller = useRef<HTMLDivElement>(null)
  const today = todayISO()
  const days = daysInMonth(year, month)
  const leading = weekdayOf(days[0])
  const trailing = (7 - ((leading + days.length) % 7)) % 7

  // 달력이 화면보다 넓을 때(휴대폰) 오늘 칸이 가운데 오게 맞춘다
  useEffect(() => {
    const box = scroller.current
    if (!box || box.scrollWidth <= box.clientWidth) return
    const cell = box.querySelector<HTMLElement>('.cell.today')
    box.scrollLeft = cell ? cell.offsetLeft - (box.clientWidth - cell.offsetWidth) / 2 : 0
  }, [year, month])

  const onKey = (e: KeyboardEvent<HTMLDivElement>, iso: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onPick(iso)
    }
  }

  return (
    <div className={`sheet${loading ? ' loading' : ''}`}>
      <div className="cal-scroll" ref={scroller}>
        <div className="cal-head" aria-hidden="true">
          {WEEKDAY_KO.map((w, i) => (
            <div key={w} className={i === 0 ? 'sun' : i === 6 ? 'sat' : ''}>{w}</div>
          ))}
        </div>

        {/* 달이 바뀔 때마다 새로 그려서 칸이 차례로 떠오르게 한다 */}
        <div className="cal-grid" key={`${year}-${month}`}>
          {Array.from({ length: leading }).map((_, i) => (
            <div key={`lead-${i}`} className="cell blank" />
          ))}

          {days.map((iso, i) => {
            const { shift, cares, events } = pickVisible(
              hidden, shiftsByDate.get(iso), careByDate.get(iso) ?? [], eventsByDate.get(iso) ?? [], lineMenuOf,
            )
            const w = weekdayOf(iso)
            const holiday = holidayName(iso)
            const note = shift ? notesByDate.get(iso) : undefined
            const numTone = w === 0 || holiday ? ' sun' : w === 6 ? ' sat' : ''

            return (
              <div
                key={iso}
                role="button"
                tabIndex={0}
                data-date={iso}
                className={`cell${iso === today ? ' today' : ''}${holiday ? ' holiday' : ''}`}
                style={{ '--i': leading + i } as CSSProperties}
                onClick={() => onPick(iso)}
                onKeyDown={(e) => onKey(e, iso)}
              >
                <div className="num-row">
                  <span className={`num${numTone}`} aria-hidden="true">{Number(iso.slice(8, 10))}</span>
                  {holiday && <span className="holiday-name">{holiday}</span>}
                  {iso === today && <span className="today-tag" aria-hidden="true">오늘</span>}
                  <span className="sr-only">{formatDateKo(iso)}{holiday ? ` ${holiday}` : ''}</span>
                </div>

                {shift && (
                  <div className={`c-work${shift.changed ? ' changed' : ''}`}>
                    <span className="c-place">{shift.is_closed ? '휴무' : postName(shift.post_id)}</span>
                    {shift.changed && <span className="c-tag">변경</span>}
                    {note && <div className="c-memo">안내 · {note}</div>}
                  </div>
                )}

                {events.map((item) => <LineInCell key={item.id} item={item} menu={lineMenuOf(item.menu_id)} />)}

                {cares.map((log) => <CareInCell key={log.id} log={log} />)}
              </div>
            )
          })}

          {Array.from({ length: trailing }).map((_, i) => (
            <div key={`trail-${i}`} className="cell blank" />
          ))}
        </div>
      </div>
    </div>
  )
}

/** 칸 안의 한 줄 일정 — 시간과 한 줄 글만 */
function LineInCell({ item, menu }: { item: EventItem; menu: Menu }) {
  return (
    <div
      className="c-line"
      style={{ '--c': menu.color } as CSSProperties}
      title={`${menu.name} · ${item.time ? `${item.time} ` : ''}${item.text}`}
    >
      <span className="c-dot" aria-hidden="true" />
      {item.time && <span className="c-ltime">{item.time}</span>}
      <span className="c-ltext">{item.text}</span>
    </div>
  )
}

/** 칸 안의 돌봄 일지 한 건 — 날짜 창의 일지 카드와 같은 내용 */
function CareInCell({ log }: { log: CareLog }) {
  return (
    <div className={`c-care${log.special_note ? ' flagged' : ''}`}>
      {log.client_name && (
        <div className="c-meta">
          <span className="c-who">{log.client_name}</span>
        </div>
      )}
      <p className="c-body">{log.work_done}</p>
      {log.special_note && (
        <div className="c-special">
          <b>특이사항</b>
          <p>{log.special_note}</p>
        </div>
      )}
    </div>
  )
}
