import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error(
    '.env 파일에 VITE_SUPABASE_URL 과 VITE_SUPABASE_ANON_KEY 를 넣어주세요. (.env.example 참고)',
  )
}

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
})

// 해설사 근무표 앱과 같은 규칙으로 로그인해야 같은 PIN 이 통한다
const LOGIN_EMAIL_DOMAIN = import.meta.env.VITE_LOGIN_EMAIL_DOMAIN ?? 'guide.local'
const PIN_PEPPER = import.meta.env.VITE_PIN_PEPPER ?? ''

export const emailForLoginCode = (loginCode: string) => `${loginCode}@${LOGIN_EMAIL_DOMAIN}`
export const passwordForPin = (pin: string) => `${pin}${PIN_PEPPER}`

/** 이 일지를 쓰는 사람 (해설사 근무표 명단의 이름과 똑같이) */
export const OWNER_NAME = import.meta.env.VITE_OWNER_NAME || '김태순'

/** 화면에 보이는 이름 (명단에서 찾는 이름 OWNER_NAME 과 따로 둔다) */
export const DISPLAY_NAME = import.meta.env.VITE_DISPLAY_NAME || '권희'

export const SCHEDULE_URL =
  import.meta.env.VITE_SCHEDULE_URL ?? 'https://haeseolsa-schedule.vercel.app/'
