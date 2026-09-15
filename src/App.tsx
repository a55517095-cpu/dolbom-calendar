import { useMemo, useState, type CSSProperties } from 'react'
import { useApp } from './state/AppContext'
import { MonthPicker, Notice, Spinner } from './components/ui'
import Login from './pages/Login'
import FilterBar from './components/FilterBar'
import Calendar from './components/Calendar'
import MonthList from './components/MonthList'
import CareHours from './components/CareHours'
import DayModal, { type Compose } from './components/DayModal'
import SettingsModal from './components/SettingsModal'
import MenuEditor from './components/MenuEditor'
import { currentYearMonth, daysInMonth, todayISO } from './lib/date'
import { CARE, EVENT, WORK } from './lib/menus'
import { DEMO, resetDemo } from './lib/demo'
import { readStored, writeStored } from './lib/storage'
import { DISPLAY_NAME } from './lib/supabase'

const HIDDEN_KEY = 'care-cal-hidden-menus'

/** 상단 보기에서 끈 메뉴 (새로 추가한 메뉴는 켜진 채로 시작하도록 "끈 것"을 기억한다) */
function loadHidden(): Set<string> {
  try {
    const v = JSON.parse(readStored(HIDDEN_KEY) || '[]')
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const k = key(item)
    const list = map.get(k)
    if (list) list.push(item)
    else map.set(k, [item])
  }
  return map
}

export default function App() {
  const {
    session, me, ready, error, refresh, signOut, toast,
    year, month, setMonth, shifts, careLogs, events, dayNotes, sheetMissing, loading,
    menus, lineMenuOf, colorOf,
  } = useApp()

  const [hidden, setHiddenState] = useState<Set<string>>(loadHidden)
  const setHidden = (next: Set<string>) => {
    setHiddenState(next)
    writeStored(HIDDEN_KEY, JSON.stringify([...next]))
  }
  /** 켜진 메뉴를 누르면 끄고, 꺼진 메뉴를 누르면 켠다 (여러 개 함께 켤 수 있다) */
  const toggleMenu = (id: string) => {
    const next = new Set(hidden)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setHidden(next)
  }

  const [day, setDay] = useState<{ date: string; compose: Compose } | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [menuEditorOpen, setMenuEditorOpen] = useState(false)

  const shiftsByDate = useMemo(() => new Map(shifts.map((s) => [s.work_date, s])), [shifts])
  const careByDate = useMemo(() => groupBy(careLogs, (c) => c.log_date), [careLogs])
  const eventsByDate = useMemo(() => groupBy(events, (e) => e.date), [events])
  const notesByDate = useMemo(() => new Map(dayNotes.map((n) => [n.work_date, n.body])), [dayNotes])

  const counts = useMemo(() => {
    const c: Record<string, number> = { [CARE]: careLogs.length, [WORK]: shifts.length }
    for (const e of events) {
      const id = lineMenuOf(e.menu_id).id
      c[id] = (c[id] ?? 0) + 1
    }
    return c
  }, [careLogs, shifts, events, lineMenuOf])

  if (!ready) return <div className="app"><Spinner /></div>
  if (!session) return <div className="app"><Login /></div>

  if (!me) {
    return (
      <div className="app">
        <div className="login">
          {error ? (
            <>
              <Notice kind="error">정보를 불러오지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.</Notice>
              <button className="btn block" onClick={() => void refresh()}>다시 시도</button>
              <p className="help">{error}</p>
            </>
          ) : (
            <Notice kind="error">이 계정이 해설사 명단에 연결되어 있지 않습니다. 관리자에게 알려주세요.</Notice>
          )}
          <button className="btn ghost block" style={{ marginTop: 12 }} onClick={() => void signOut()}>
            로그아웃
          </button>
        </div>
      </div>
    )
  }

  const goThisMonth = () => {
    const now = currentYearMonth()
    setMonth(now.year, now.month)
  }

  const writeToday = (compose: Exclude<Compose, null>) => {
    goThisMonth()
    setDay({ date: todayISO(), compose })
  }

  const allHidden = menus.every((m) => hidden.has(m.id))

  // 메뉴 편집에서 고른 색을 화면 전체(버튼 · 카드 · 칸)에 입힌다
  const colors = {
    '--care': colorOf(CARE),
    '--work': colorOf(WORK),
    '--event': colorOf(EVENT),
  } as CSSProperties

  return (
    <div className="app" style={colors}>
      {DEMO && (
        <div className="demo-banner" role="note">
          <span>
            <b>체험 화면</b> · 근무와 기록은 예시입니다. 입력한 내용은 이 브라우저에만 임시로 저장되고
            구글시트에는 저장되지 않습니다.
          </span>
          <span className="demo-actions">
            <button className="link-btn" onClick={() => { resetDemo(); void refresh() }}>예시로 되돌리기</button>
            <a className="link-btn" href={window.location.pathname}>체험 끝내기</a>
          </span>
        </div>
      )}

      <header className="masthead">
        <div>
          <span className="eyebrow">CARE · WORK JOURNAL</span>
          <h1>돌봄 근무일지</h1>
        </div>
        <div className="mast-side">
          <span className="who">{DISPLAY_NAME} 님</span>
          <button className="pill-btn" onClick={() => setSettingsOpen(true)}>설정</button>
        </div>
      </header>

      <FilterBar
        menus={menus}
        hidden={hidden}
        counts={counts}
        onToggle={toggleMenu}
        onAll={() => setHidden(new Set())}
        onEdit={() => setMenuEditorOpen(true)}
      />

      <div className="controls">
        <MonthPicker year={year} month={month} onChange={setMonth} />
        <div className="controls-right">
          <button className="btn ghost" onClick={goThisMonth}>이번 달</button>
          {!sheetMissing && (
            <>
              <button className="btn event" onClick={() => writeToday('event')}>＋ 일정</button>
              <button className="btn care" onClick={() => writeToday('care')}>＋ 오늘 일지 쓰기</button>
            </>
          )}
        </div>
      </div>

      {sheetMissing && (
        <Notice kind="warn">
          돌봄 일지와 일정을 저장할 구글시트가 아직 연결되지 않았습니다. (근무는 지금도 볼 수 있습니다)
          <button className="link-btn" onClick={() => setSettingsOpen(true)}>설정에서 연결하기</button>
          <a className="link-btn" href="?demo">연결 전에 입력 체험해 보기</a>
        </Notice>
      )}
      {error && <Notice kind="error">{error}</Notice>}
      {allHidden && <Notice kind="info">보기를 모두 껐습니다. 위에서 보고 싶은 메뉴를 눌러주세요.</Notice>}

      {!sheetMissing && <CareHours month={month} logs={careLogs} />}

      <Calendar
        year={year}
        month={month}
        hidden={hidden}
        loading={loading}
        shiftsByDate={shiftsByDate}
        careByDate={careByDate}
        eventsByDate={eventsByDate}
        notesByDate={notesByDate}
        onPick={(date) => setDay({ date, compose: null })}
      />
      <p className="hint">
        날짜를 누르면 일지 · 일정을 고치거나 새로 쓸 수 있습니다.
        <span className="only-narrow"> 달력은 좌우로 밀어서 볼 수 있습니다.</span>
      </p>

      <MonthList
        days={daysInMonth(year, month)}
        month={month}
        hidden={hidden}
        shiftsByDate={shiftsByDate}
        careByDate={careByDate}
        eventsByDate={eventsByDate}
        notesByDate={notesByDate}
        onPick={(date) => setDay({ date, compose: null })}
      />

      {day && (
        <DayModal
          key={`${day.date}-${day.compose}`}
          date={day.date}
          compose={day.compose}
          onClose={() => setDay(null)}
        />
      )}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      {menuEditorOpen && <MenuEditor onClose={() => setMenuEditorOpen(false)} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}
