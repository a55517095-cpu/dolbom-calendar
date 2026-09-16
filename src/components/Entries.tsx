import type { CSSProperties, ReactNode } from 'react'
import type { CareLog, EventItem, Menu, Shift } from '../lib/types'

export function CareCard({
  log, actions, footer,
}: { log: CareLog; actions?: ReactNode; footer?: ReactNode }) {
  return (
    <article className="entry care">
      <div className="entry-head">
        <span className="entry-kind">돌봄</span>
        {log.client_name && <span className="entry-tag">{log.client_name}</span>}
        {actions && <span className="entry-actions">{actions}</span>}
      </div>
      <p className="entry-body">{log.work_done}</p>
      {log.special_note && (
        <div className="special">
          <b>특이사항</b>
          <p>{log.special_note}</p>
        </div>
      )}
      {footer}
    </article>
  )
}

export function WorkCard({
  shift, place, note,
}: { shift: Shift; place: string; note?: string }) {
  return (
    <article className="entry work">
      <div className="entry-head">
        <span className="entry-kind">해설사 근무</span>
        {shift.changed && <span className="entry-tag">변경된 근무</span>}
      </div>
      <div className="entry-title">{shift.is_closed ? '휴무' : place}</div>
      {note && <div className="memo">안내 · {note}</div>}
    </article>
  )
}

/** 한 줄 일정 — 메뉴 · 시간 · 한 줄 글 */
export function LineCard({
  item, menu, actions, footer,
}: { item: EventItem; menu: Menu; actions?: ReactNode; footer?: ReactNode }) {
  return (
    <article className="entry line" style={{ '--c': menu.color } as CSSProperties}>
      <div className="line-row">
        <span className="line-menu">{menu.name}</span>
        {item.time && <span className="entry-time">{item.time}</span>}
        <span className="line-text">{item.text}</span>
        {actions && <span className="entry-actions">{actions}</span>}
      </div>
      {footer}
    </article>
  )
}
