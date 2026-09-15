import { useState, type CSSProperties } from 'react'
import { useApp } from '../state/AppContext'
import { friendlyError } from '../lib/api'
import { CARE, EVENT, MENU_NAME_MAX, PALETTE, WORK, isFixedMenu, newMenuId } from '../lib/menus'
import type { Menu } from '../lib/types'
import { Modal, Notice } from './ui'

const FIXED_NOTE: Record<string, string> = {
  [CARE]: '일지 · 한 일과 특이사항',
  [WORK]: '해설사 근무표에서 가져옴',
  [EVENT]: '시간과 한 줄 글',
}

/** 한 줄 일정 메뉴를 늘리거나 지우고, 모든 메뉴의 색을 바꾼다 */
export default function MenuEditor({ onClose }: { onClose: () => void }) {
  const { menus, saveMenus, sheetMissing } = useApp()
  const [list, setList] = useState<Menu[]>(menus)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const dirty = JSON.stringify(list) !== JSON.stringify(menus)

  const update = (id: string, patch: Partial<Menu>) => {
    setList((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)))
    setErr(null)
  }

  const add = () => {
    const used = new Set(list.map((m) => m.color))
    const color = PALETTE.find((c) => !used.has(c)) ?? PALETTE[3]
    setList((prev) => [...prev, { id: newMenuId(), name: '', color }])
  }

  const remove = (m: Menu) => {
    if (m.name.trim() && !window.confirm(`「${m.name}」 메뉴를 지울까요? 이 메뉴의 일정은 「일정」으로 옮겨집니다.`)) return
    setList((prev) => prev.filter((x) => x.id !== m.id))
  }

  const requestClose = () => {
    if (dirty && !window.confirm('바꾼 내용이 저장되지 않았습니다. 닫을까요?')) return
    onClose()
  }

  const save = async () => {
    const cleaned = list.map((m) => ({ ...m, name: m.name.trim() }))
    if (cleaned.some((m) => !m.name)) return setErr('메뉴 이름을 적어주세요. 필요 없는 메뉴는 지워주세요.')
    const names = cleaned.map((m) => m.name)
    const dup = names.find((n, i) => names.indexOf(n) !== i)
    if (dup) return setErr(`「${dup}」 이름이 두 번 있습니다.`)
    if (names.includes('전체')) return setErr('「전체」는 메뉴 이름으로 쓸 수 없습니다.')

    setBusy(true)
    setErr(null)
    try {
      await saveMenus(cleaned)
      onClose()
    } catch (e) {
      setErr(friendlyError(e))
      setBusy(false)
    }
  }

  return (
    <Modal
      title="메뉴 편집"
      subtitle="한 줄 일정 메뉴를 늘리고, 메뉴마다 색을 바꿀 수 있습니다"
      onClose={requestClose}
      dismissable={!dirty}
    >
      <div className="menu-list">
        {list.map((m) => (
          <div className="menu-row" key={m.id} style={{ '--c': m.color } as CSSProperties}>
            <div className="menu-top">
              <span className="menu-swatch" aria-hidden="true" />
              {isFixedMenu(m.id) ? (
                <span className="menu-fixed">
                  <b>{m.name}</b>
                  <small>{FIXED_NOTE[m.id]}</small>
                </span>
              ) : (
                <input
                  className="menu-name"
                  value={m.name}
                  maxLength={MENU_NAME_MAX}
                  placeholder="메뉴 이름 (예: 병원)"
                  aria-label="메뉴 이름"
                  autoFocus={!m.name}
                  onChange={(e) => update(m.id, { name: e.target.value })}
                />
              )}
              {!isFixedMenu(m.id) && (
                <button className="link-btn danger" onClick={() => remove(m)}>지우기</button>
              )}
            </div>

            <div className="palette" role="radiogroup" aria-label={`${m.name || '새 메뉴'} 색`}>
              {PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={m.color === c}
                  aria-label={`색 ${c}`}
                  className="pal"
                  style={{ background: c }}
                  onClick={() => update(m.id, { color: c })}
                />
              ))}
              <label className={`pal custom${PALETTE.includes(m.color) ? '' : ' on'}`} title="색 직접 고르기">
                <input
                  type="color"
                  value={m.color}
                  aria-label="색 직접 고르기"
                  onChange={(e) => update(m.id, { color: e.target.value.toLowerCase() })}
                />
              </label>
            </div>
          </div>
        ))}
      </div>

      <button className="btn ghost block" style={{ marginTop: 12 }} onClick={add}>＋ 한 줄 일정 메뉴 추가</button>

      {sheetMissing && <Notice kind="warn">구글시트를 연결해야 메뉴를 저장할 수 있습니다.</Notice>}
      {err && <div className="form-error" role="alert" style={{ marginTop: 12 }}>{err}</div>}

      <div className="form-actions" style={{ marginTop: 14 }}>
        <button className="btn ghost" onClick={requestClose} disabled={busy}>취소</button>
        <button className="btn" onClick={() => void save()} disabled={busy || sheetMissing || !dirty}>
          {busy ? '저장하는 중…' : '저장'}
        </button>
      </div>
      <p className="help center">메뉴와 색은 구글시트 「메뉴」 탭에 저장되어 휴대폰과 PC에 똑같이 적용됩니다.</p>
    </Modal>
  )
}
