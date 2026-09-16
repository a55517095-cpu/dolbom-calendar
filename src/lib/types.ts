// 해설사 근무표 앱의 테이블 중 이 앱이 읽는 부분만

export type Post = {
  id: string
  name: string
  sort_order: number
  active: boolean
}

export type Member = {
  id: string
  auth_user_id: string | null
  login_code: string
  name: string
  role: 'member' | 'admin'
  active: boolean
}

/** 로그인 전에 볼 수 있는 최소한의 정보 */
export type PublicMember = {
  id: string
  name: string
  login_code: string
}

export type Shift = {
  id: string
  schedule_id: string
  work_date: string // 'YYYY-MM-DD'
  post_id: string
  member_id: string | null
  is_closed: boolean
  changed: boolean
}

export type DayNote = {
  id: string
  schedule_id: string
  work_date: string
  body: string
}

// 돌봄 일지 (구글시트 「돌봄일지」 탭의 한 줄)

export type CareLog = {
  id: string
  log_date: string // 'YYYY-MM-DD'
  /** 그날 간 장소 (표의 열 이름은 예전 그대로 client_name) */
  client_name: string | null
  work_done: string
  special_note: string | null
  created_at: string
  updated_at: string
}

/** 입력 화면에서 다루는 모양 (빈칸은 빈 문자열) */
export type CareDraft = {
  log_date: string
  /** 그날 간 장소 */
  client_name: string
  work_done: string
  special_note: string
}

/** 입력 칸 중 날짜를 뺀 나머지 (AI 정리가 채우는 칸) */
export type CareFields = Omit<CareDraft, 'log_date'>

// 한 줄 일정 (구글시트 「일정」 탭의 한 줄) — 시간과 한 줄 글

export type EventItem = {
  id: string
  date: string // 'YYYY-MM-DD'
  time: string | null // 'HH:MM'
  menu_id: string
  text: string
  created_at: string
  updated_at: string
}

export type EventDraft = {
  date: string
  time: string
  menu_id: string
  text: string
}

/** 상단 보기 메뉴 (구글시트 「메뉴」 탭) */
export type Menu = {
  id: string
  name: string
  color: string // '#rrggbb'
}

/** 한 달치 구글시트 기록 */
export type JournalMonth = {
  care: CareLog[]
  events: EventItem[]
  menus: Menu[]
  /** 구글시트 스크립트에 AI(Claude) API 키가 연결돼 있다 */
  aiConnected?: boolean
}
