import { useEffect, useState } from 'react'
import { useApp } from '../state/AppContext'
import { SCHEDULE_URL } from '../lib/supabase'
import {
  fetchAiStatus, friendlyError, looksLikeSheetUrl, pingSheet, removeAiKey, saveAiKey,
  type AiStatus, type SheetStatus,
} from '../lib/api'
import { DEMO } from '../lib/demo'
import { Modal, Notice } from './ui'

type Check =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'ok'; status: SheetStatus }
  | { kind: 'error'; message: string }

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const { me, session, sheetUrl, setSheetUrl, signOut } = useApp()
  const [draft, setDraft] = useState(sheetUrl)
  const [check, setCheck] = useState<Check>({ kind: 'idle' })

  const runCheck = async () => {
    setCheck({ kind: 'checking' })
    try {
      setCheck({ kind: 'ok', status: await pingSheet() })
    } catch (e) {
      setCheck({ kind: 'error', message: friendlyError(e) })
    }
  }

  // 이미 연결돼 있으면 창을 열 때 상태를 보여준다
  useEffect(() => {
    if (sheetUrl && !DEMO) void runCheck()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    const url = draft.trim()
    if (url && !looksLikeSheetUrl(url)) {
      setCheck({ kind: 'error', message: '웹 앱 주소는 https://script.google.com/macros/s/…/exec 모양이어야 합니다.' })
      return
    }
    setSheetUrl(url)
    if (url) await runCheck()
    else setCheck({ kind: 'idle' })
  }

  if (DEMO) {
    return (
      <Modal title="설정" subtitle="체험 화면" onClose={onClose}>
        <div className="form">
          <p className="help">
            체험 화면에서는 구글시트에 연결하지 않습니다. 입력한 일지는 이 브라우저에만 임시로 저장됩니다.
          </p>
          <div className="field">
            <span className="label">AI 연결 <span className="opt">말로 일지 채우기</span></span>
            <p className="help">
              체험 화면에서는 AI를 연결할 수 없습니다. 말로 채우기를 누르면 말한 내용이 「한 일」에 그대로 들어갑니다.
            </p>
          </div>
          <a className="btn ghost block" href={window.location.pathname}>체험 끝내기 (실제 화면으로)</a>
          <button className="btn block" onClick={onClose}>닫기</button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="설정" subtitle={me ? `${me.name} 님으로 로그인됨` : undefined} onClose={onClose}>
      <div className="form">
        <div className="field">
          <label htmlFor="sheet-url">구글시트 연결 주소</label>
          <input
            id="sheet-url"
            type="url"
            inputMode="url"
            autoComplete="off"
            placeholder="https://script.google.com/macros/s/…/exec"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <p className="help">돌봄 일지는 이 주소의 구글시트에 저장되고, 시트가 곧 백업이 됩니다.</p>
          <button
            className="btn care block"
            style={{ marginTop: 8 }}
            disabled={check.kind === 'checking'}
            onClick={() => void save()}
          >
            {check.kind === 'checking' ? '확인하는 중…' : '저장하고 연결 확인'}
          </button>
          {check.kind === 'ok' && (
            <Notice kind="info">
              연결되었습니다 · 일지 {check.status.count}건 · 일정 {check.status.events ?? 0}건
              <a href={check.status.sheet_url} target="_blank" rel="noreferrer">구글시트 열기 ↗</a>
            </Notice>
          )}
          {check.kind === 'error' && <Notice kind="error">{check.message}</Notice>}
        </div>

        <AiSection connectedSheet={check.kind === 'ok'} />

        <div className="field">
          <span className="label">로그인 계정</span>
          <code className="account">{session?.user.email}</code>
          <p className="help">구글시트 스크립트 속성 <b>ALLOWED_EMAIL</b> 에 이 값을 넣습니다.</p>
        </div>

        <p className="help">근무는 해설사 근무표의 {me?.name} 님 근무를 실시간으로 가져옵니다.</p>
        <a className="btn ghost block" href={SCHEDULE_URL} target="_blank" rel="noreferrer">
          해설사 근무표 앱 열기 ↗
        </a>
        <button className="btn ghost block" onClick={() => void signOut()}>로그아웃</button>
        <button className="btn block" onClick={onClose}>닫기</button>
      </div>
    </Modal>
  )
}

/**
 * AI 연결 — Anthropic API 키를 넣으면 구글시트 스크립트가 확인 후 저장한다.
 * 키는 김태순 님 구글 계정(스크립트 속성)에만 있고, 이 기기 · 앱 · 저장소에는 남지 않는다.
 */
function AiSection({ connectedSheet }: { connectedSheet: boolean }) {
  const { setAiConnected } = useApp()
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [phase, setPhase] = useState<'idle' | 'loading' | 'saving'>('idle')
  const [err, setErr] = useState<string | null>(null)
  const [key, setKey] = useState('')
  const [editing, setEditing] = useState(false)

  // 구글시트 연결이 확인되면 AI 연결 상태를 읽는다
  useEffect(() => {
    if (!connectedSheet) return
    setPhase('loading')
    fetchAiStatus()
      .then((s) => { setStatus(s); setAiConnected(s.connected); setErr(null) })
      .catch((e) => setErr(friendlyError(e)))
      .finally(() => setPhase('idle'))
  }, [connectedSheet, setAiConnected])

  const apply = (s: AiStatus) => {
    setStatus(s)
    setAiConnected(s.connected)
    setKey('')
    setEditing(false)
    setErr(null)
  }

  const connect = async () => {
    const k = key.trim()
    if (!/^sk-ant-/.test(k)) return setErr('API 키는 sk-ant- 로 시작합니다. 복사한 키를 그대로 붙여넣어 주세요.')
    setPhase('saving')
    try {
      apply(await saveAiKey(k))
    } catch (e) {
      setErr(friendlyError(e))
    } finally {
      setPhase('idle')
    }
  }

  const disconnect = async () => {
    if (!window.confirm('AI 연결을 끊을까요?\n말로 채우기는 말한 내용을 「한 일」에 그대로 넣는 방식으로 돌아갑니다.')) return
    setPhase('saving')
    try {
      apply(await removeAiKey())
    } catch (e) {
      setErr(friendlyError(e))
    } finally {
      setPhase('idle')
    }
  }

  const title = <span className="label">AI 연결 <span className="opt">말로 일지 채우기</span></span>

  if (!connectedSheet) {
    return (
      <div className="field">
        {title}
        <p className="help">구글시트 연결이 확인되면 AI(Claude)를 연결할 수 있습니다.</p>
      </div>
    )
  }

  if (!status) {
    return (
      <div className="field">
        {title}
        {err ? <Notice kind="error">{err}</Notice> : <p className="help">AI 연결 상태를 확인하는 중…</p>}
      </div>
    )
  }

  return (
    <div className="field">
      {status.connected && !editing ? (
        <>
          {title}
          <Notice kind="info">
            AI 연결됨 · 키 <code>{status.key_hint}</code>
            <br />말로 채우기를 하면 AI가 시간 · 대상 · 한 일 · 특이사항 칸으로 나눠 채웁니다.
          </Notice>
          <div className="form-actions" style={{ marginTop: 8 }}>
            <button className="btn ghost" disabled={phase !== 'idle'} onClick={() => { setEditing(true); setErr(null) }}>
              키 바꾸기
            </button>
            <button className="btn ghost" disabled={phase !== 'idle'} onClick={() => void disconnect()}>
              {phase === 'saving' ? '끊는 중…' : '연결 끊기'}
            </button>
          </div>
        </>
      ) : (
        <>
          <label htmlFor="ai-key">AI 연결 <span className="opt">말로 일지 채우기 · 나중에 해도 됩니다</span></label>
          <input
            id="ai-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-ant-…"
            value={key}
            onChange={(e) => { setKey(e.target.value); setErr(null) }}
          />
          <button
            className="btn care block"
            style={{ marginTop: 8 }}
            disabled={phase !== 'idle' || !key.trim()}
            onClick={() => void connect()}
          >
            {phase === 'saving' ? '키를 확인하는 중…' : '저장하고 AI 연결'}
          </button>
          {editing && (
            <button className="btn ghost block" style={{ marginTop: 8 }} onClick={() => { setEditing(false); setKey(''); setErr(null) }}>
              취소
            </button>
          )}
          <ol className="help steps">
            <li><a href="https://console.anthropic.com" target="_blank" rel="noreferrer">console.anthropic.com ↗</a> 에 가입합니다.</li>
            <li><b>Billing</b> 에서 크레딧을 충전하고, <b>Limits</b> 에서 월 사용 한도를 걸어 둡니다.</li>
            <li><b>API Keys → Create Key</b> 로 만든 키(sk-ant-…)를 위 칸에 붙여넣습니다.</li>
          </ol>
          <p className="help">
            키는 구글시트 스크립트에만 저장되고 이 기기에는 남지 않아, 한 번 연결하면 PC · 휴대폰 모두에서 쓰입니다.
            연결 전에는 말로 채우기를 누르면 말한 내용이 「한 일」에 그대로 들어갑니다.
          </p>
        </>
      )}
      {err && <Notice kind="error">{err}</Notice>}
    </div>
  )
}
