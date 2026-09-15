import { useEffect, useRef, type ReactNode } from 'react'

export function Spinner() {
  return <div className="spinner" role="status" aria-label="불러오는 중" />
}

export function Notice({
  kind = 'info', children,
}: { kind?: 'info' | 'error' | 'warn'; children: ReactNode }) {
  return <div className={`notice ${kind}`} role={kind === 'error' ? 'alert' : undefined}>{children}</div>
}

/**
 * dismissable 이 false 이면 바깥을 누르거나 Esc 를 눌러도 닫히지 않는다.
 * (일지를 쓰는 도중 실수로 닫혀 내용이 날아가는 것을 막는다)
 */
export function Modal({
  title, subtitle, onClose, dismissable = true, children,
}: {
  title: string
  subtitle?: string
  onClose: () => void
  dismissable?: boolean
  children: ReactNode
}) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  useEffect(() => {
    if (!dismissable) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [dismissable])

  return (
    <div
      className="backdrop"
      onMouseDown={(e) => { if (dismissable && e.target === e.currentTarget) onClose() }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <div className="modal-sub">{subtitle}</div>}
          </div>
          <button className="modal-close" onClick={onClose} aria-label="닫기">×</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

export function MonthPicker({
  year, month, onChange,
}: { year: number; month: number; onChange: (year: number, month: number) => void }) {
  const step = (delta: number) => {
    const total = year * 12 + (month - 1) + delta
    onChange(Math.floor(total / 12), (total % 12) + 1)
  }
  return (
    <div className="month-picker">
      <button onClick={() => step(-1)} aria-label="이전 달">‹</button>
      <div className="label" aria-live="polite">{year}년 {month}월</div>
      <button onClick={() => step(1)} aria-label="다음 달">›</button>
    </div>
  )
}
