import { useState } from 'react'
import { useApp } from '../state/AppContext'
import { friendlyError } from '../lib/api'
import { formatDateKo, hhmm, relativeDayKo } from '../lib/date'
import { holidayName } from '../lib/holidays'
import { EVENT, isLineMenu } from '../lib/menus'
import type { CareDraft, CareLog, EventDraft, EventItem } from '../lib/types'
import { Modal, Notice } from './ui'
import { CareCard, LineCard, WorkCard } from './Entries'
import EntryForm from './EntryForm'
import EventForm from './EventForm'

/** 날짜 창을 열자마자 쓰기 화면으로 갈 때 */
export type Compose = 'care' | 'event' | null

type Mode =
  | { kind: 'view' }
  | { kind: 'care'; log?: CareLog }
  | { kind: 'event'; item?: EventItem }

type Target = { kind: 'care' | 'event'; id: string }

const emptyCare = (date: string): CareDraft => ({
  log_date: date, start_time: '', end_time: '', client_name: '', work_done: '', special_note: '',
})

const draftFromLog = (log: CareLog): CareDraft => ({
  log_date: log.log_date,
  start_time: hhmm(log.start_time),
  end_time: hhmm(log.end_time),
  client_name: log.client_name ?? '',
  work_done: log.work_done,
  special_note: log.special_note ?? '',
})

const emptyEvent = (date: string): EventDraft => ({ date, time: '', menu_id: EVENT, text: '' })

export default function DayModal({
  date: initialDate, compose, onClose,
}: { date: string; compose: Compose; onClose: () => void }) {
  const {
    year, month, setMonth, shifts, dayNotes, careLogs, events, menus, lineMenuOf, storeMissing,
    postName, saveCare, removeCare, saveEvent, removeEvent,
  } = useApp()

  const [date, setDate] = useState(initialDate)
  const [mode, setMode] = useState<Mode>(compose && !storeMissing ? { kind: compose } : { kind: 'view' })
  const [dirty, setDirty] = useState(false)
  const [confirm, setConfirm] = useState<Target | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const shift = shifts.find((s) => s.work_date === date)
  const note = dayNotes.find((n) => n.work_date === date)?.body
  const logs = careLogs.filter((c) => c.log_date === date)
  const dayEvents = events.filter((e) => e.date === date)
  const holiday = holidayName(date)
  const writing = mode.kind !== 'view'

  const requestClose = () => {
    if (writing && dirty && !window.confirm('작성 중인 내용이 사라집니다. 닫을까요?')) return
    onClose()
  }

  /** 저장한 날짜를 보여준다 (다른 달이면 그 달로 넘어간다) */
  const showSaved = (saved: string) => {
    const [y, m] = saved.split('-').map(Number)
    if (y !== year || m !== month) setMonth(y, m)
    setDate(saved)
    setDirty(false)
    setMode({ kind: 'view' })
  }

  const submitCare = async (draft: CareDraft) => {
    await saveCare(draft, mode.kind === 'care' ? mode.log?.id : undefined)
    showSaved(draft.log_date)
  }

  const submitEvent = async (draft: EventDraft) => {
    await saveEvent(draft, mode.kind === 'event' ? mode.item?.id : undefined)
    showSaved(draft.date)
  }

  const remove = async () => {
    if (!confirm) return
    setDeleting(true)
    setDeleteError(null)
    try {
      if (confirm.kind === 'care') await removeCare(confirm.id)
      else await removeEvent(confirm.id)
      setConfirm(null)
    } catch (e) {
      setDeleteError(friendlyError(e))
    } finally {
      setDeleting(false)
    }
  }

  const actions = (target: Target, edit: () => void) => (
    <>
      <button className="link-btn" onClick={edit}>수정</button>
      <button className="link-btn danger" onClick={() => { setConfirm(target); setDeleteError(null) }}>삭제</button>
    </>
  )

  const confirmBox = (target: Target, question: string) =>
    confirm?.kind === target.kind && confirm.id === target.id && (
      <div className="confirm">
        <span className="grow">{question} 되돌릴 수 없습니다.</span>
        <button className="btn danger sm" disabled={deleting} onClick={() => void remove()}>지우기</button>
        <button className="btn ghost sm" disabled={deleting} onClick={() => setConfirm(null)}>취소</button>
        {deleteError && <div className="form-error">{deleteError}</div>}
      </div>
    )

  const subtitle =
    mode.kind === 'care' ? (mode.log ? '돌봄 일지 고치기' : '돌봄 일지 쓰기')
      : mode.kind === 'event' ? (mode.item ? '일정 고치기' : '일정 추가')
        : [relativeDayKo(date), holiday].filter(Boolean).join(' · ')

  return (
    <Modal title={formatDateKo(date)} subtitle={subtitle} onClose={requestClose} dismissable={!writing}>
      {mode.kind === 'care' && (
        <EntryForm
          key={mode.log?.id ?? 'new-care'}
          editingId={mode.log?.id}
          initial={mode.log ? draftFromLog(mode.log) : emptyCare(date)}
          submitLabel={mode.log ? '고친 내용 저장' : '저장'}
          onSubmit={submitCare}
          onCancel={() => { setDirty(false); setMode({ kind: 'view' }) }}
          onDirtyChange={setDirty}
        />
      )}

      {mode.kind === 'event' && (
        <EventForm
          key={mode.item?.id ?? 'new-event'}
          initial={
            mode.item
              ? { date: mode.item.date, time: mode.item.time ?? '', menu_id: lineMenuOf(mode.item.menu_id).id, text: mode.item.text }
              : emptyEvent(date)
          }
          menus={menus.filter((m) => isLineMenu(m.id))}
          submitLabel={mode.item ? '고친 내용 저장' : '저장'}
          onSubmit={submitEvent}
          onCancel={() => { setDirty(false); setMode({ kind: 'view' }) }}
          onDirtyChange={setDirty}
        />
      )}

      {mode.kind === 'view' && (
        <>
          <section className="day-sec">
            <h3 className="sec-title work">해설사 근무</h3>
            {shift ? (
              <WorkCard shift={shift} place={postName(shift.post_id)} note={note} />
            ) : (
              <>
                <p className="muted">이 날은 근무가 없습니다.</p>
                {note && <div className="memo">안내 · {note}</div>}
              </>
            )}
          </section>

          {storeMissing ? (
            <section className="day-sec">
              <Notice kind="warn">Supabase 에 일지 표를 만들면(README 1) 일정과 돌봄 일지를 쓸 수 있습니다.</Notice>
            </section>
          ) : (
            <>
              <section className="day-sec">
                <h3 className="sec-title event">
                  일정 {dayEvents.length > 0 && <span className="count">{dayEvents.length}</span>}
                </h3>
                <div className="stack">
                  {dayEvents.length === 0 && <p className="muted">등록된 일정이 없습니다.</p>}
                  {dayEvents.map((item) => {
                    const target: Target = { kind: 'event', id: item.id }
                    return (
                      <LineCard
                        key={item.id}
                        item={item}
                        menu={lineMenuOf(item.menu_id)}
                        actions={actions(target, () => setMode({ kind: 'event', item }))}
                        footer={confirmBox(target, '이 일정을 지울까요?')}
                      />
                    )
                  })}
                  <button className="btn ghost block" onClick={() => setMode({ kind: 'event' })}>
                    ＋ 이 날 일정 추가
                  </button>
                </div>
              </section>

              <section className="day-sec">
                <h3 className="sec-title care">
                  돌봄 일지 {logs.length > 0 && <span className="count">{logs.length}</span>}
                </h3>
                <div className="stack">
                  {logs.length === 0 && <p className="muted">아직 쓴 일지가 없습니다.</p>}
                  {logs.map((log) => {
                    const target: Target = { kind: 'care', id: log.id }
                    return (
                      <CareCard
                        key={log.id}
                        log={log}
                        actions={actions(target, () => setMode({ kind: 'care', log }))}
                        footer={confirmBox(target, '이 일지를 지울까요?')}
                      />
                    )
                  })}
                  <button className="btn care block" onClick={() => setMode({ kind: 'care' })}>
                    ＋ 이 날 일지 쓰기
                  </button>
                </div>
              </section>
            </>
          )}
        </>
      )}
    </Modal>
  )
}
