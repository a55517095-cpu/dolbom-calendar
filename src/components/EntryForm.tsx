import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react'
import { useApp } from '../state/AppContext'
import { friendlyError } from '../lib/api'
import type { CareDraft } from '../lib/types'
import {
  CONTENT_KEYS, LISTEN_UNSUPPORTED, canListen, fillCareByVoice, hasContent, startListening,
  type Listening, type VoiceMode,
} from '../lib/voice'

type Props = {
  initial: CareDraft
  submitLabel: string
  onSubmit: (draft: CareDraft) => Promise<void>
  onCancel: () => void
  onDirtyChange: (dirty: boolean) => void
}

type Voice = { phase: 'idle' } | { phase: 'listening'; text: string } | { phase: 'thinking' }

export default function EntryForm({ initial, submitLabel, onSubmit, onCancel, onDirtyChange }: Props) {
  const { aiConnected } = useApp()
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

  /** 들은 글을 칸에 넣는다 (칸이 비었으면 새로 쓰기, 내용이 있으면 보완하기) */
  const organize = async (transcript: string, mode: VoiceMode) => {
    listening.current = null
    if (!transcript.trim()) {
      setVoice({ phase: 'idle' })
      setErr('말소리가 들리지 않았습니다. 마이크 버튼을 다시 누르고 말해 주세요.')
      return
    }
    setVoice({ phase: 'thinking' })
    const before = latest.current
    try {
      const fields = await fillCareByVoice(transcript, before, mode, aiConnected)
      setD((prev) => ({ ...prev, ...fields }))
      if (aiConnected) {
        setUndo({ draft: before, label: mode === 'new' ? 'AI 채우기 되돌리기' : 'AI 보완 되돌리기' })
        setVoiceNote(mode === 'new' ? 'AI가 칸을 채웠습니다. 확인하고 저장해 주세요.' : 'AI가 내용을 보완했습니다. 확인하고 저장해 주세요.')
      } else {
        setUndo({ draft: before, label: '말로 채우기 되돌리기' })
        setVoiceNote(mode === 'new' ? '말한 내용을 「한 일」에 적었습니다. 확인하고 저장해 주세요.' : '말한 내용을 「한 일」에 덧붙였습니다. 확인하고 저장해 주세요.')
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
        onEnd: (text) => void organize(text, mode),
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

  const idleHelp = aiConnected
    ? filled
      ? '마이크를 누르고 더할 내용이나 고칠 점을 말하면 AI가 지금 내용에 보완합니다.'
      : '마이크를 누르고 오늘 한 일을 말하면 AI가 아래 칸을 알맞게 채웁니다.'
    : filled
      ? '마이크를 누르고 더할 내용을 말하면 「한 일」에 덧붙입니다. (설정에서 AI를 연결하면 칸별로 정리됩니다)'
      : '마이크를 누르고 오늘 한 일을 말하면 「한 일」에 적어 줍니다. (설정에서 AI를 연결하면 칸별로 정리됩니다)'

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

        {voice.phase === 'listening' ? (
          <p className="voice-live" aria-live="polite">
            {voice.text || <span className="muted">듣고 있습니다. 한 일 · 시간 · 대상 · 특이사항을 편하게 말씀하세요.</span>}
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

      <div className="field">
        <label htmlFor="f-client">대상 · 장소 <span className="opt">선택</span></label>
        <input id="f-client" type="text" placeholder="예) ○○○ 어르신 댁" maxLength={60} {...bind('client_name')} />
      </div>

      <div className="field care-field">
        <label htmlFor="f-work">한 일</label>
        <textarea
          id="f-work"
          placeholder="무슨 일을 했는지 적어주세요"
          autoFocus
          {...bind('work_done')}
        />
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
