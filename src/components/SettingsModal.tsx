import { useEffect, useState } from 'react'
import { useApp } from '../state/AppContext'
import { DISPLAY_NAME, SCHEDULE_URL } from '../lib/supabase'
import {
  STORE_MISSING_MESSAGE, exportCsv, friendlyError, getSheetUrl, importFromSheet, looksLikeSheetUrl, pingStore,
  saveSheetUrl, type ImportResult, type StoreStatus,
} from '../lib/api'
import { fetchAiStatus, removeAiKey, saveAiKey, type AiStatus } from '../lib/ai'
import { DEMO } from '../lib/demo'
import { todayISO } from '../lib/date'
import { Modal, Notice } from './ui'

type Check =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'ok'; status: StoreStatus }
  | { kind: 'error'; message: string }

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const { me, session, storeMissing, refresh, signOut } = useApp()
  const [check, setCheck] = useState<Check>({ kind: 'idle' })

  const runCheck = async () => {
    setCheck({ kind: 'checking' })
    try {
      setCheck({ kind: 'ok', status: await pingStore() })
    } catch (e) {
      setCheck({ kind: 'error', message: friendlyError(e) })
    }
  }

  // 창을 열 때 저장소 상태를 보여준다
  useEffect(() => {
    if (!DEMO) void runCheck()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (DEMO) {
    return (
      <Modal title="설정" subtitle="체험 화면" onClose={onClose}>
        <div className="form">
          <p className="help">
            체험 화면에서는 Supabase 에 저장하지 않습니다. 입력한 일지는 이 브라우저에만 임시로 저장됩니다.
          </p>
          <div className="field">
            <span className="label">AI 연결 <span className="opt">받아쓴 글 정리</span></span>
            <p className="help">체험 화면에서는 AI 를 연결할 수 없습니다.</p>
          </div>
          <a className="btn ghost block" href={window.location.pathname}>체험 끝내기 (실제 화면으로)</a>
          <button className="btn block" onClick={onClose}>닫기</button>
        </div>
      </Modal>
    )
  }

  const storeOk = check.kind === 'ok'

  return (
    <Modal title="설정" subtitle={me ? `${DISPLAY_NAME} 님으로 로그인됨` : undefined} onClose={onClose}>
      <div className="form">
        <div className="field">
          <span className="label">저장소</span>
          {check.kind === 'checking' && <p className="help">저장소를 확인하는 중…</p>}
          {check.kind === 'ok' && (
            <Notice kind="info">
              Supabase 에 저장됨 · 일지 {check.status.count}건 · 일정 {check.status.events ?? 0}건
            </Notice>
          )}
          {check.kind === 'error' && (
            <>
              <Notice kind="error">{check.message}</Notice>
              <button className="btn ghost block" style={{ marginTop: 8 }} onClick={() => { void runCheck(); void refresh() }}>
                다시 확인
              </button>
            </>
          )}
          {storeMissing && check.kind === 'ok' && <Notice kind="warn">{STORE_MISSING_MESSAGE}</Notice>}
          <p className="help">
            돌봄 일지 · 일정 · 메뉴는 해설사 근무표와 같은 Supabase 에 저장되고, 본인만 읽고 쓸 수 있습니다.
          </p>
        </div>

        <AiSection enabled={storeOk} />

        <BackupSection enabled={storeOk} />

        <ImportSection enabled={storeOk} />

        <div className="field">
          <span className="label">로그인 계정</span>
          <code className="account">{session?.user.email}</code>
        </div>

        <p className="help">근무는 해설사 근무표의 {DISPLAY_NAME} 님 근무를 실시간으로 가져옵니다.</p>
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
 * AI 연결 — Anthropic API 키를 넣으면 앱이 확인 후 Supabase(care_settings)에 저장한다.
 * 키는 김태순 님 계정에서만 읽을 수 있고, 이 기기 · GitHub 에는 남지 않는다.
 */
function AiSection({ enabled }: { enabled: boolean }) {
  const { setAiConnected } = useApp()
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [phase, setPhase] = useState<'idle' | 'loading' | 'saving'>('idle')
  const [err, setErr] = useState<string | null>(null)
  const [key, setKey] = useState('')
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    if (!enabled) return
    setPhase('loading')
    fetchAiStatus(true)
      .then((s) => { setStatus(s); setAiConnected(s.connected); setErr(null) })
      .catch((e) => setErr(friendlyError(e)))
      .finally(() => setPhase('idle'))
  }, [enabled, setAiConnected])

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
    if (!window.confirm('AI 연결을 끊을까요?\n「AI 로 정리」 버튼이 사라지고, 시간 · 대상 · 특이사항은 직접 적게 됩니다.')) return
    setPhase('saving')
    try {
      apply(await removeAiKey())
    } catch (e) {
      setErr(friendlyError(e))
    } finally {
      setPhase('idle')
    }
  }

  const title = <span className="label">AI 연결 <span className="opt">받아쓴 글을 칸별로 정리</span></span>

  if (!enabled) {
    return (
      <div className="field">
        {title}
        <p className="help">저장소가 확인되면 AI(Claude)를 연결할 수 있습니다.</p>
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
            <br />「한 일」에 받아쓴 글을 「AI 로 정리」로 시간 · 대상 · 한 일 · 특이사항 칸에 나눠 넣습니다.
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
          <label htmlFor="ai-key">AI 연결 <span className="opt">받아쓴 글 정리 · 나중에 해도 됩니다</span></label>
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
            키는 Supabase 의 본인 설정에만 저장되고 이 기기에는 남지 않아, 한 번 연결하면 PC · 휴대폰 모두에서 쓰입니다.
          </p>
        </>
      )}
      {err && <Notice kind="error">{err}</Notice>}
    </div>
  )
}

/** 백업 — 모든 일지와 일정을 CSV 파일로 내려받는다 (엑셀 · 구글시트에서 열린다) */
function BackupSection({ enabled }: { enabled: boolean }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'info' | 'error'; text: string } | null>(null)

  const download = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const csv = await exportCsv()
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `돌봄근무일지-${todayISO()}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
      setMsg({ kind: 'info', text: '내려받기를 시작했습니다. 파일은 휴대폰의 다운로드 폴더에 저장됩니다.' })
    } catch (e) {
      setMsg({ kind: 'error', text: friendlyError(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="field">
      <span className="label">백업 <span className="opt">CSV 내려받기</span></span>
      <button className="btn ghost block" disabled={!enabled || busy} onClick={() => void download()}>
        {busy ? '만드는 중…' : '모든 일지 · 일정 내려받기 (CSV)'}
      </button>
      <p className="help">가끔 내려받아 두면 안심입니다. 엑셀이나 구글시트에서 바로 열립니다.</p>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
    </div>
  )
}

/** 예전 구글시트에 있던 기록을 한 번 가져온다 */
function ImportSection({ enabled }: { enabled: boolean }) {
  const { refresh } = useApp()
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState(getSheetUrl)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const run = async () => {
    const u = url.trim()
    if (!looksLikeSheetUrl(u)) {
      setErr('웹 앱 주소는 https://script.google.com/macros/s/…/exec 모양이어야 합니다.')
      return
    }
    if (!window.confirm('구글시트의 일지 · 일정 · 메뉴를 Supabase 로 복사합니다.\n이미 있는 기록(같은 id)은 건너뜁니다. 진행할까요?')) return
    setBusy(true)
    setErr(null)
    setResult(null)
    try {
      saveSheetUrl(u)
      const r = await importFromSheet(u)
      setResult(r)
      await refresh()
    } catch (e) {
      setErr(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <div className="field">
        <button className="link-btn" onClick={() => setOpen(true)} disabled={!enabled}>
          예전 구글시트의 기록 가져오기 ▸
        </button>
      </div>
    )
  }

  return (
    <div className="field">
      <label htmlFor="sheet-url">예전 구글시트 웹 앱 주소</label>
      <input
        id="sheet-url"
        type="url"
        inputMode="url"
        autoComplete="off"
        placeholder="https://script.google.com/macros/s/…/exec"
        value={url}
        onChange={(e) => { setUrl(e.target.value); setErr(null) }}
      />
      <p className="help">전에 구글시트에 저장했던 일지 · 일정 · 메뉴를 한 번에 복사합니다. 여러 번 눌러도 겹치지 않습니다.</p>
      <div className="form-actions" style={{ marginTop: 8 }}>
        <button className="btn ghost" onClick={() => setOpen(false)} disabled={busy}>닫기</button>
        <button className="btn" disabled={!enabled || busy || !url.trim()} onClick={() => void run()}>
          {busy ? '가져오는 중…' : '가져오기'}
        </button>
      </div>
      {result && (
        <Notice kind="info">
          가져왔습니다 · 일지 {result.care}건 · 일정 {result.events}건 · 메뉴 {result.menus}개
          (이미 있던 기록은 건너뛰었습니다)
        </Notice>
      )}
      {err && <Notice kind="error">{err}</Notice>}
    </div>
  )
}
