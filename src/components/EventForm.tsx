import { useEffect, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from 'react'
import { friendlyError } from '../lib/api'
import type { EventDraft, Menu } from '../lib/types'

/** 한 줄 일정은 캘린더 칸에 한 줄로 들어가도록 짧게 */
const TEXT_MAX = 60

type Props = {
  initial: EventDraft
  /** 고를 수 있는 한 줄 일정 메뉴 (일정 + 추가한 메뉴) */
  menus: Menu[]
  submitLabel: string
  onSubmit: (draft: EventDraft) => Promise<void>
  onCancel: () => void
  onDirtyChange: (dirty: boolean) => void
}

export default function EventForm({ initial, menus, submitLabel, onSubmit, onCancel, onDirtyChange }: Props) {
  const [start] = useState(initial)
  const [d, setD] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    onDirtyChange((Object.keys(start) as (keyof EventDraft)[]).some((k) => start[k] !== d[k]))
  }, [d, start, onDirtyChange])

  const set = (patch: Partial<EventDraft>) => {
    setD((prev) => ({ ...prev, ...patch }))
    setErr(null)
  }

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    if (busy) return
    if (!d.date) return setErr('날짜를 골라주세요.')
    const text = d.text.replace(/\s+/g, ' ').trim()
    if (!text) return setErr('내용을 적어주세요.')
    setBusy(true)
    setErr(null)
    try {
      await onSubmit({ ...d, text })
    } catch (x) {
      setErr(friendlyError(x))
      setBusy(false)
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit()
  }

  return (
    <form className="form" onSubmit={submit} onKeyDown={onKeyDown}>
      <div className="row2">
        <div className="field">
          <label htmlFor="e-date">날짜</label>
          <input id="e-date" type="date" required value={d.date} onChange={(e) => set({ date: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="e-time">시간 <span className="opt">선택</span></label>
          <input id="e-time" type="time" value={d.time} onChange={(e) => set({ time: e.target.value })} />
        </div>
      </div>

      <div className="field">
        <span className="label" id="e-menu-label">메뉴</span>
        <div className="menu-pick" role="radiogroup" aria-labelledby="e-menu-label">
          {menus.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={d.menu_id === m.id}
              className="menu-chip"
              style={{ '--c': m.color } as CSSProperties}
              onClick={() => set({ menu_id: m.id })}
            >
              <span className="swatch" aria-hidden="true" />
              {m.name}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label htmlFor="e-text">내용 <span className="opt">한 줄 · {TEXT_MAX}자까지</span></label>
        <input
          id="e-text"
          type="text"
          maxLength={TEXT_MAX}
          placeholder="예) 정형외과 진료 예약"
          autoFocus
          value={d.text}
          onChange={(e) => set({ text: e.target.value })}
        />
      </div>

      {err && <div className="form-error" role="alert">{err}</div>}

      <div className="form-actions">
        <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>취소</button>
        <button type="submit" className="btn event" disabled={busy}>
          {busy ? '저장하는 중…' : submitLabel}
        </button>
      </div>
    </form>
  )
}
