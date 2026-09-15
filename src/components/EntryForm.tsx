import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react'
import { useApp } from '../state/AppContext'
import { friendlyError } from '../lib/api'
import { formatHM, monthHours, spanMinutes, spanOf } from '../lib/careHours'
import type { CareDraft } from '../lib/types'
import {
  CONTENT_KEYS, IS_MOBILE, LISTEN_UNSUPPORTED, canListen, fillCareByVoice, hasContent, startListening,
  type Listening, type VoiceMode,
} from '../lib/voice'

type Props = {
  initial: CareDraft
  submitLabel: string
  onSubmit: (draft: CareDraft) => Promise<void>
  onCancel: () => void
  onDirtyChange: (dirty: boolean) => void
  /** 고치는 중인 일지 (90시간 합계에서 원래 시간을 빼고 새 시간으로 계산) */
  editingId?: string
}

type Voice = { phase: 'idle' } | { phase: 'listening'; text: string } | { phase: 'thinking' }

export default function EntryForm({ initial, submitLabel, onSubmit, onCancel, onDirtyChange, editingId }: Props) {
  const { aiConnected, careLogs, year, month } = useApp()
  const [start] = useState(initial)
  const [d, setD] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // 말로 채우기
  const [voice, setVoice] = useState<Voice>({ phase: 'idle' })
  const [voiceNote, setVoiceNote] = useState<string | null>(null)
  const [undo, setUndo] = useState<{ draft: CareDraft; label: string } | null>(null)
  const listening = useRef<Listening | null>(null)
  const latest = useRef(d)
  latest.current = d

  useEffect(() => () => listening.current?.cancel(), [])

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
  const voiceBusy = voice.phase !== 'idle'

  // 90시간 미리 보기 — 지금 불러온 달의 일지일 때만 달 합계를 계산한다
  const thisSpan = spanOf(d.log_date, d.start_time, d.end_time)
  const [logYear, logMonth] = d.log_date.split('-').map(Number)
  const projected = thisSpan && logYear === year && logMonth === month
    ? monthHours(careLogs.filter((c) => c.id !== editingId), [thisSpan])
    : null

  /** 들은 글을 칸에 넣는다 (칸이 비었으면 새로 쓰기, 내용이 있으면 보완하기) */
  const organize = async (transcript: string, mode: VoiceMode, why?: string) => {
    listening.current = null
    if (!transcript.trim()) {
      setVoice({ phase: 'idle' })
      setErr(`말소리가 들리지 않았습니다. 마이크 버튼을 다시 누르고 말해 주세요.${why ? ` (${why})` : ''}`)
      return
    }
    // 「말하기 끝」을 누르기 전에 저절로 멈췄으면 이유를 함께 알린다
    const stoppedNote = why ? ` 「말하기 끝」을 누르기 전에 인식이 멈췄습니다 (${why}). 더 말할 내용은 마이크를 다시 눌러 주세요.` : ''
    setVoice({ phase: 'thinking' })
    const before = latest.current
    try {
      const fields = await fillCareByVoice(transcript, before, mode, aiConnected)
      setD((prev) => ({ ...prev, ...fields }))
      if (aiConnected) {
        setUndo({ draft: before, label: mode === 'new' ? 'AI 채우기 되돌리기' : 'AI 보완 되돌리기' })
        setVoiceNote((mode === 'new' ? 'AI가 칸을 채웠습니다. 확인하고 저장해 주세요.' : 'AI가 내용을 보완했습니다. 확인하고 저장해 주세요.') + stoppedNote)
      } else {
        setUndo({ draft: before, label: '말로 채우기 되돌리기' })
        setVoiceNote((mode === 'new' ? '말한 내용을 「한 일」에 적었습니다. 확인하고 저장해 주세요.' : '말한 내용을 「한 일」에 덧붙였습니다. 확인하고 저장해 주세요.') + stoppedNote)
      }
    } catch (x) {
      setErr(friendlyError(x))
    } finally {
      setVoice({ phase: 'idle' })
    }
  }

  const onMic = async () => {
    if (voice.phase === 'listening') return listening.current?.stop()
    if (voiceBusy || busy) return
    if (!canListen()) return setErr(LISTEN_UNSUPPORTED)

    const mode: VoiceMode = hasContent(latest.current) ? 'supplement' : 'new'
    setErr(null)
    setVoiceNote(null)
    setVoice({ phase: 'listening', text: '' })
    try {
      listening.current = await startListening({
        onText: (text) => setVoice({ phase: 'listening', text }),
        onEnd: (text, why) => void organize(text, mode, why),
        onError: (message) => {
          listening.current = null
          setVoice({ phase: 'idle' })
          setErr(message)
        },
      })
    } catch (x) {
      listening.current = null
      setVoice({ phase: 'idle' })
      setErr(friendlyError(x))
    }
  }

  /**
   * 「한 일」에 적힌(또는 키보드 음성 입력으로 받아쓴) 글을 AI 가 칸별로 나눠 넣는다.
   * 휴대폰 브라우저의 음성 인식은 말이 잠깐 끊길 때마다 멈추고 그 틈의 말이 새므로,
   * 휴대폰에서는 키보드의 마이크로 받아쓴 뒤 이 버튼을 누르는 쪽이 훨씬 안정적이다.
   */
  const organizeTyped = async () => {
    if (voiceBusy || busy || !aiConnected) return
    const before = latest.current
    const transcript = before.work_done.trim()
    if (!transcript) return setErr('먼저 「한 일」 칸에 글을 적거나 받아써 주세요.')
    const base: CareDraft = { ...before, work_done: '' }
    const mode: VoiceMode = hasContent(base) ? 'supplement' : 'new'
    setErr(null)
    setVoiceNote(null)
    setVoice({ phase: 'thinking' })
    try {
      const fields = await fillCareByVoice(transcript, base, mode, true)
      setD((prev) => ({ ...prev, ...fields }))
      setUndo({ draft: before, label: 'AI 정리 되돌리기' })
      setVoiceNote('AI가 「한 일」의 글을 칸별로 나눠 넣었습니다. 확인하고 저장해 주세요.')
    } catch (x) {
      setErr(friendlyError(x))
    } finally {
      setVoice({ phase: 'idle' })
    }
  }

  /** 날짜만 남기고 칸을 비운다 — 다음 마이크는 새로 쓰기 */
  const clearFields = () => {
    setUndo({ draft: d, label: '초기화 되돌리기' })
    setD((prev) => ({ ...prev, ...Object.fromEntries(CONTENT_KEYS.map((k) => [k, ''])) }))
    setErr(null)
    setVoiceNote(null)
  }

  const restore = () => {
    if (!undo) return
    setD(undo.draft)
    setUndo(null)
    setVoiceNote(null)
  }

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    if (busy || voiceBusy) return
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

  const micLabel =
    voice.phase === 'listening' ? '말하기 끝'
      : voice.phase === 'thinking' ? (aiConnected ? 'AI가 정리하는 중…' : '적는 중…')
        : filled ? '말로 보완하기' : '말로 채우기'

  const more = !filled ? ' 말이 잠시 끊기면 이어서 듣느라 시작음이 다시 날 수 있습니다.' : ''
  const canOrganizeTyped = aiConnected && d.work_done.trim() !== '' && !voiceBusy && !busy
  const idleHelp = (aiConnected
    ? filled
      ? '마이크를 누르고 더할 내용이나 고칠 점을 말하면 AI가 지금 내용에 보완합니다.'
      : '마이크를 누르고 오늘 한 일을 말하면 AI가 아래 칸을 알맞게 채웁니다.'
    : filled
      ? '마이크를 누르고 더할 내용을 말하면 「한 일」에 덧붙입니다. (설정에서 AI를 연결하면 칸별로 정리됩니다)'
      : '마이크를 누르고 오늘 한 일을 말하면 「한 일」에 적어 줍니다. (설정에서 AI를 연결하면 칸별로 정리됩니다)') + more

  return (
    <form className="form" onSubmit={submit} onKeyDown={onKeyDown}>
      <div className="voice-bar">
        <button
          type="button"
          className={`btn voice${voice.phase === 'listening' ? ' on' : ''}`}
          onClick={() => void onMic()}
          disabled={voice.phase === 'thinking' || busy}
          aria-pressed={voice.phase === 'listening'}
        >
          {voice.phase === 'listening' ? <StopIcon /> : <MicIcon />}
          {micLabel}
        </button>
        <button type="button" className="btn ghost sm" onClick={clearFields} disabled={!filled || voiceBusy || busy}>
          초기화
        </button>
        {undo && !voiceBusy && (
          <button type="button" className="link-btn" onClick={restore}>↶ {undo.label}</button>
        )}

        {IS_MOBILE && aiConnected && voice.phase === 'idle' && (
          <p className="voice-tip">
            <b>휴대폰에서 더 잘 되는 방법</b> — 「한 일」 칸을 누른 뒤 <b>키보드의 마이크(🎤)</b> 로 받아쓰고,
            아래 <b>「AI 로 정리」</b> 를 누르면 시간 · 대상 · 한 일 · 특이사항으로 나눠 줍니다.
            키보드 받아쓰기는 말이 끊겨도 멈추지 않습니다.
          </p>
        )}

        {voice.phase === 'listening' ? (
          <p className="voice-live" aria-live="polite">
            {voice.text || (
              <span className="muted">
                듣고 있습니다. 한 일 · 시간 · 대상 · 특이사항을 편하게 말씀하세요. 다 말했으면 「말하기 끝」을 누르세요.
              </span>
            )}
          </p>
        ) : voiceNote ? (
          <p className="voice-note" role="status">{voiceNote}</p>
        ) : (
          <p className="help">{idleHelp}</p>
        )}
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
          placeholder={IS_MOBILE && aiConnected ? '키보드의 마이크(🎤)로 받아쓰거나 직접 적어주세요' : '무슨 일을 했는지 적어주세요'}
          autoFocus
          {...bind('work_done')}
        />
        {aiConnected && (
          <div className="organize-row">
            <button type="button" className="btn ghost sm" onClick={() => void organizeTyped()} disabled={!canOrganizeTyped}>
              {voice.phase === 'thinking' ? 'AI가 정리하는 중…' : '✦ AI 로 정리 (시간 · 대상 · 특이사항으로 나누기)'}
            </button>
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
        <button type="submit" className="btn care" disabled={busy || voiceBusy}>
          {busy ? '저장하는 중…' : submitLabel}
        </button>
      </div>
      <p className="help center">Ctrl + Enter 로도 저장됩니다.</p>
    </form>
  )
}

const MicIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <rect x="9" y="3" width="6" height="12" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
)

const StopIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
)
