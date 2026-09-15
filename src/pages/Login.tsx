import { useCallback, useEffect, useState } from 'react'
import { supabase, emailForLoginCode, passwordForPin, OWNER_NAME } from '../lib/supabase'
import { fetchPublicMemberByName, friendlyError } from '../lib/api'
import type { PublicMember } from '../lib/types'
import { Notice, Spinner } from '../components/ui'

/**
 * 김태순 님 전용 — 이름 고르기 없이 해설사 근무표와 같은 PIN 4자리로 들어온다.
 * (이름은 .env 의 VITE_OWNER_NAME)
 */
export default function Login() {
  // undefined = 불러오는 중, null = 명단에 없음
  const [person, setPerson] = useState<PublicMember | null | undefined>(undefined)
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const loadPerson = useCallback(async () => {
    setPerson(undefined)
    setError(null)
    try {
      setPerson(await fetchPublicMemberByName(OWNER_NAME))
    } catch (e) {
      setError(friendlyError(e))
      setPerson(null)
    }
  }, [])

  useEffect(() => { void loadPerson() }, [loadPerson])

  const pressKey = useCallback((digit: string) => {
    if (!person || busy || pin.length >= 4) return
    const next = pin + digit
    setPin(next)
    setError(null)
    if (next.length < 4) return

    setBusy(true)
    void supabase.auth
      .signInWithPassword({ email: emailForLoginCode(person.login_code), password: passwordForPin(next) })
      .then(({ error: signInError }) => {
        setBusy(false)
        // 성공하면 AppProvider 가 화면을 바꿔준다
        if (signInError) {
          setPin('')
          setError(friendlyError(signInError))
        }
      })
  }, [person, busy, pin])

  // 컴퓨터에서는 숫자 키보드로도 누를 수 있게
  useEffect(() => {
    if (!person) return
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) pressKey(e.key)
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1))
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [person, pressKey])

  if (person === undefined) return <Spinner />

  if (person === null) {
    return (
      <div className="login">
        <div className="login-title">
          <span className="eyebrow">CARE · WORK JOURNAL</span>
          <h1>돌봄 근무일지</h1>
        </div>
        {error ? (
          <>
            <Notice kind="error">{error}</Notice>
            <button className="btn block" onClick={() => void loadPerson()}>다시 시도</button>
          </>
        ) : (
          <Notice kind="error">
            해설사 근무표 명단에서 <b>{OWNER_NAME}</b> 님을 찾을 수 없습니다. 근무표 관리자에게 확인해 주세요.
          </Notice>
        )}
      </div>
    )
  }

  return (
    <div className="login">
      <div className="login-title">
        <span className="eyebrow">CARE · WORK JOURNAL</span>
        <h1>{person.name} 님</h1>
        <p className="sub">해설사 근무표와 같은 비밀번호 4자리를 눌러주세요</p>
      </div>

      {error && <Notice kind="error">{error}</Notice>}

      <div className="pin-dots" aria-label={`${pin.length}자리 입력됨`}>
        {[0, 1, 2, 3].map((i) => <span key={i} className={i < pin.length ? 'filled' : ''} />)}
      </div>

      {busy ? (
        <Spinner />
      ) : (
        <div className="keypad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button key={d} onClick={() => pressKey(d)}>{d}</button>
          ))}
          <span aria-hidden="true" />
          <button onClick={() => pressKey('0')}>0</button>
          <button className="word" onClick={() => setPin((p) => p.slice(0, -1))}>지우기</button>
        </div>
      )}

      <p className="login-help">비밀번호를 잊으셨으면 근무표 관리자에게 말씀해 주세요.</p>
      <p className="login-help"><a href="?demo">로그인 없이 체험 화면 보기</a></p>
    </div>
  )
}
