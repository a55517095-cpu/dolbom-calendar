import type { CSSProperties } from 'react'
import type { Menu } from '../lib/types'

type Props = {
  menus: Menu[]
  hidden: ReadonlySet<string>
  counts: Record<string, number>
  onToggle: (menuId: string) => void
  onAll: () => void
  onEdit: () => void
}

/**
 * 상단 보기. 메뉴는 여러 개를 함께 켤 수 있고, 켜진 메뉴를 다시 누르면 꺼진다.
 * 「전체」는 모든 메뉴를 다시 켠다.
 */
export default function FilterBar({ menus, hidden, counts, onToggle, onAll, onEdit }: Props) {
  const allOn = menus.every((m) => !hidden.has(m.id))
  const total = menus.reduce((sum, m) => sum + (counts[m.id] ?? 0), 0)

  // 「전체」 동그라미는 앞 세 메뉴 색을 나눠 칠한다
  const head = menus.slice(0, 3)
  const mix = `conic-gradient(${head
    .map((m, i) => `${m.color} ${(i / head.length) * 100}% ${((i + 1) / head.length) * 100}%`)
    .join(', ')})`

  return (
    <div className="filters" role="group" aria-label="보기 선택 — 여러 개를 함께 고를 수 있습니다">
      <button
        className="filter f-all"
        aria-pressed={allOn}
        onClick={onAll}
        style={{ '--mix': mix } as CSSProperties}
      >
        <span className="swatch" aria-hidden="true" />
        전체
        <span className="n">{total}</span>
      </button>

      {menus.map((m) => (
        <button
          key={m.id}
          className="filter"
          aria-pressed={!hidden.has(m.id)}
          onClick={() => onToggle(m.id)}
          style={{ '--c': m.color } as CSSProperties}
        >
          <span className="swatch" aria-hidden="true" />
          {m.name}
          <span className="n">{counts[m.id] ?? 0}</span>
        </button>
      ))}

      <button className="filter edit" onClick={onEdit}>✎ 메뉴 편집</button>
    </div>
  )
}
