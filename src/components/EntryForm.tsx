import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react'
import { useApp } from '../state/AppContext'
import { friendlyError } from '../lib/api'
import { formatHM, monthHours, spanMinutes, spanOf } from '../lib/careHours'
import type { CareDraft } from '../lib/types'
import { CONTENT_KEYS, IS_MOBILE, hasContent, organizeCare, type OrganizeMode } from '../lib/organize'

type Props = {
  initial: CareDraft
  submitLabel: string
  onSubmit: (draft: CareDraft) => Promise<void>
  onCancel: () => void
  onDirtyChange: (dirty: boolean) => void
  /** 고치는 중인 일지 (90시간 합계에서 원래 시간을 빼고 새 시간으로 계산) */
  editingId?: string
}

/**
 * 돌봄 일지 입력.
 * 말로 쓰기: 「한 일」 칸에 키보드의 마이크(음성 입력)로 받아쓴 뒤 「AI 로 정리」를 누르면
 * AI 가 시작 · 끝 · 대상 · 한 일 · 특이사항 칸으로 나눠 넣는다. 이미 채운 뒤 더 받아쓰고 다시 누르면 덧붙여 정리한다.
 * (브라우저 자체 음성 인식은 휴대폰에서 말이 잠깐 끊길 때마다 멈추고 그 틈의 말이 새서 쓰지 않는다)
 */
export default function EntryForm({ initial, submitLabel, onSubmit, onCancel, onDirtyChange, editingId }: Props) {
  const { aiConnected, careLogs, year, month } = useApp()
  const [start] = useState(initial)
  const [d, setD] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // AI 로 정리
  const [organizing, setOrganizing] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [undo, setUndo] = useState<{ draft: CareDraft; label: string } | null>(null)
  const latest = useRef(d)
  latest.current = d

  useEffect(() => {
    onDirtyChange((Object.keys(start) as (keyof CareDraft)[]).some((k) => start[k] !== d[k]))
  }, [d, start, onDirtyChange])

  const bind = (key: keyof CareDraft) => ({
    value: d[key],
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setD((prev) => ({ ...prev, [key]: e.target.value }))
      setErr(null)
      setUndo(null) // 직접 고친 뒤에는 되돌리기로 덮어쓰지 않게
    },
  })

  const filled = hasContent(d)

  // 90시간 미리 보기 — 지금 불러온 달의 일지일 때만 달 합계를 계산한다
  const thisSpan = spanOf(d.log_date, d.start_time, d.end_time)
  const [logYear, logMonth] = d.log_date.split('-').map(Number)
  const projected = thisSpan && logYear === year && logMonth === month
    ? monthHours(careLogs.filter((c) => c.id !== editingId), [thisSpan])
    : null

  /**
   * 「한 일」에 적힌(받아쓴) 글을 AI 가 칸별로 나눠 넣는다.
   * 다른 칸이 비어 있으면 새로 쓰기, 이미 채워져 있으면 그 내용을 살리면서 「한 일」의 새 글을 알맞은 칸에 더한다.
   */
  const organize = async () => {
    if (organizing || busy || !aiConnected) return
    const before = latest.current
    const transcript = before.work_done.trim()
    if (!transcript) return setErr('먼저 「한 일」 칸에 키보드의 마이크로 받아쓰거나 글을 적어 주세요.')
    const base: CareDraft = { ...before, work_done: '' }
    const mode: OrganizeMode = hasContent(base) ? 'supplement' : 'new'
    setErr(null)
    setNote(null)
    setOrganizing(true)
    try {
      const fields = await organizeCare(transcript, base, mode)
      setD((prev) => ({ ...prev, ...fields }))
      setUndo({ draft: before, label: 'AI 정리 되돌리기' })
      setNote(mode === 'new'
        ? 'AI가 「한 일」의 글을 시간 · 대상 · 한 일 · 특이사항으로 나눠 넣었습니다. 확인하고 저장해 주세요.'
        : 'AI가 「한 일」의 새 글을 기존 내용에 덧붙여 정리했습니다. 확인하고 저장해 주세요.')
    } catch (x) {
      setErr(friendlyError(x))
    } finally {
      setOrganizing(false)
    }
  }

  /** 날짜만 남기고 칸을 비운다 */
  const clearFields = () => {
    setUndo({ draft: d, label: '초기화 되돌리기' })
    setD((prev) => ({ ...prev, ...Object.fromEntries(CONTENT_KEYS.map((k) => [k, ''])) }))
    setErr(null)
    setNote(null)
  }

  const restore = () => {
    if (!undo) return
    setD(undo.draft)
    setUndo(null)
    setNote(null)
  }

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    if (busy || organizing) return
    if (!d.log_date) return setErr('날짜를 골라주세요.')
    if (!d.work_done.trim()) return setErr('한 일을 적어주세요.')
    if (d.start_time && d.end_time && d.end_time < d.start_time)
      return setErr('끝난 시간이 시작 시간보다 빠릅니다.')
    setBusy(true)
    setErr(null)
    try {
      await onSubmit(d)
    } catch (x) {
      setErr(friendlyError(x))
      setBusy(false)
    }
  }

  // Ctrl(⌘) + Enter 로 바로 저장
  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit()
  }

  const micWord = IS_MOBILE ? '키보드의 마이크(🎤)' : '키보드 음성 입력(윈도우는 Win + H)'
  const help = aiConnected
    ? filled
      ? `더할 내용은 「한 일」 칸에 ${micWord}로 받아쓰거나 적은 뒤 「AI 로 정리」를 누르세요. 기존 내용은 살리고 새 글만 알맞은 칸에 덧붙입니다.`
      : `「한 일」 칸에 ${micWord}로 오늘 한 일 · 시간 · 대상 · 특이사항을 받아쓴 뒤 「AI 로 정리」를 누르면 칸별로 나눠 줍니다.`
    : `「한 일」 칸에 ${micWord}로 받아쓰거나 직접 적어 주세요. (설정에서 AI 를 연결하면 받아쓴 글을 시간 · 대상 · 특이사항 칸으로 나눠 줍니다)`

  return (
    <form className="form" onSubmit={submit} onKeyDown={onKeyDown}>
      <div className="ai-bar">
        <button type="button" className="btn ghost sm" onClick={clearFields} disabled={!filled || organizing || busy}>
          초기화
        </button>
        {undo && !organizing && (
          <button type="button" className="link-btn" onClick={restore}>↶ {undo.label}</button>
        )}
        {note ? <p className="ai-note" role="status">{note}</p> : <p className="help">{help}</p>}
      </div>

      <div className="row3">
        <div className="field">
          <label htmlFor="f-date">날짜</label>
          <input id="f-date" type="date" required {...bind('log_date')} />
        </div>
        <div className="field">
          <label htmlFor="f-start">시작 <span className="opt">선택</span></label>
          <input id="f-start" type="time" {...bind('start_time')} />
        </div>
        <div className="field">
          <label htmlFor="f-end">끝 <span className="opt">선택</span></label>
          <input id="f-end" type="time" {...bind('end_time')} />
        </div>
      </div>

      {thisSpan && (
        <p className={`hours-preview${projected && projected.over > 0 ? ' over' : ''}`} aria-live="polite">
          이 일지 <b>{formatHM(spanMinutes(thisSpan))}</b>
          {projected && (projected.over > 0 ? (
            <> · 저장하면 {logMonth}월 {formatHM(projected.minutes)} — <b>90시간을 {formatHM(projected.over)} 넘습니다</b></>
          ) : (
            <> · 저장하면 {logMonth}월 {formatHM(projected.minutes)} · 90시간까지 <b>{formatHM(projected.remaining)} 남음</b></>
          ))}
        </p>
      )}

      <div className="field">
        <label htmlFor="f-client">대상 · 장소 <span className="opt">선택</span></label>
        <input id="f-client" type="text" placeholder="예) ○○○ 어르신 댁" maxLength={60} {...bind('client_name')} />
      </div>

      <div className="field care-field">
        <label htmlFor="f-work">한 일</label>
        <textarea
          id="f-work"
          placeholder={IS_MOBILE ? '키보드의 마이크(🎤)로 받아쓰거나 직접 적어주세요' : '무슨 일을 했는지 적어주세요'}
          autoFocus
          {...bind('work_done')}
        />
        {aiConnected && (
          <div className="organize-row">
            <button
              type="button"
              className="btn care sm"
              onClick={() => void organize()}
              disabled={organizing || busy || !d.work_done.trim()}
            >
              {organizing ? 'AI가 정리하는 중…' : '✦ AI 로 정리'}
            </button>
            <span className="help">
              {organizing ? '보통 5~15초 걸립니다. 잠시만 기다려 주세요.' : '시간 · 대상 · 한 일 · 특이사항으로 나눠 넣습니다'}
            </span>
          </div>
        )}
      </div>

      <div className="field special-field">
        <label htmlFor="f-special">특이사항 <span className="opt">없으면 비워두세요</span></label>
        <textarea id="f-special" placeholder="평소와 달랐던 점, 전달할 내용" {...bind('special_note')} />
      </div>

      {err && <div className="form-error" role="alert">{err}</div>}

      <div className="form-actions">
        <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>취소</button>
        <button type="submit" className="btn care" disabled={busy || organizing}>
          {busy ? '저장하는 중…' : submitLabel}
        </button>
      </div>
      <p className="help center">Ctrl + Enter 로도 저장됩니다.</p>
    </form>
  )
}
