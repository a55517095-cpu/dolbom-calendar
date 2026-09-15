import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { SpeechRecognition as NativeSpeech } from '@capacitor-community/speech-recognition'
import { voiceFillCare } from './api'
import { DEMO } from './demo'
import type { CareDraft, CareFields } from './types'

/**
 * 말로 돌봄 일지 채우기
 *
 * 1) 말 → 글자: 휴대폰 앱은 안드로이드 음성 인식(플러그인), PC 는 브라우저 음성 인식(크롬 · 엣지)
 * 2) 글자 → 칸: 설정에서 AI 를 연결했으면 구글시트 스크립트가 Claude 로 시간 · 대상 · 한 일 · 특이사항을 나눠 채우고,
 *    연결 전에는 말한 내용을 「한 일」에 그대로 넣는다.
 */

// ─── 1. 말 → 글자 ────────────────────────────────────────────────────────────

export type Listening = {
  /** 말하기를 마치고 지금까지 들은 글자로 끝낸다 */
  stop: () => void
  /** 들은 글자를 버리고 끝낸다 */
  cancel: () => void
}

export type ListenHandlers = {
  /** 듣는 동안 지금까지의 글자 (계속 바뀐다) */
  onText: (text: string) => void
  /**
   * 끝났을 때 최종 글자 (cancel 이면 부르지 않는다).
   * 사용자가 「말하기 끝」을 누른 것이 아니라 저절로 멈췄으면 왜 멈췄는지(why)를 함께 준다.
   */
  onEnd: (text: string, why?: string) => void
  onError: (message: string) => void
}

/**
 * 음성 인식은 말이 잠깐 끊기면 저절로 멈춘다. 그래서 「말하기 끝」을 누를 때까지 이어서 다시 듣는다 (최대 5분).
 * 아무 말도 없는 구간이 SILENT_SESSIONS 번 이어지면(대략 15~30초 조용) 그만 듣는다 —
 * 휴대폰은 다시 들을 때마다 시작음이 나므로 조용한데도 끝없이 되풀이 울리지 않게 한다.
 */
const MAX_LISTEN_MS = 5 * 60 * 1000
const SILENT_SESSIONS = 3
/** 다시 듣기 시작이 실패하면 잠시 뒤 이만큼 더 시도한다 */
const RESTART_TRIES = 3
const RESTART_DELAY_MS = 300

/** 휴대폰 · 태블릿 (키보드 음성 입력 안내를 보여줄지) */
export const IS_MOBILE = Capacitor.isNativePlatform() || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

type WebRecognition = {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }> }) => void) | null
  onerror: ((e: { error: string; message?: string }) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
}

const webRecognitionCtor = (): (new () => WebRecognition) | null => {
  const w = window as unknown as Record<string, unknown>
  return (w.SpeechRecognition || w.webkitSpeechRecognition || null) as (new () => WebRecognition) | null
}

/** 이 기기에서 말로 입력할 수 있는지 */
export const canListen = (): boolean => Capacitor.isNativePlatform() || webRecognitionCtor() !== null

export const LISTEN_UNSUPPORTED =
  '이 브라우저에서는 음성 입력을 쓸 수 없습니다. PC 에서는 크롬이나 엣지로 열어 주세요.'

/**
 * 들은 글자를 겹치지 않게 잇는다.
 * 안드로이드(삼성인터넷 · 크롬 · 앱)는 앞서 들은 글자를 포함해 다시 보내거나(누적) 같은 글자를 한 번 더 보내므로,
 * 그대로 이어 붙이면 같은 말이 두 번 적힌다. 뒤에 온 글자가 앞 글자를 포함하면 바꿔 넣고, 되풀이면 버린다.
 */
export function merge(base: string, piece: string): string {
  base = base.trim()
  piece = piece.trim()
  if (!piece) return base
  if (!base) return piece
  if (piece.startsWith(base)) return piece // 누적형: 앞 글자를 포함해 다시 왔다
  if (base.endsWith(piece)) return base // 같은 글자가 한 번 더 왔다
  return base + ' ' + piece
}

export async function startListening(h: ListenHandlers): Promise<Listening> {
  return Capacitor.isNativePlatform() ? listenNative(h) : listenWeb(h)
}

function listenWeb(h: ListenHandlers): Listening {
  const Ctor = webRecognitionCtor()
  if (!Ctor) throw new Error(LISTEN_UNSUPPORTED)

  const startedAt = Date.now()
  let committed = '' // 앞서 끝난 구간들의 글자
  let finals = '' // 지금 구간에서 확정된 글자
  let current = '' // 지금 구간의 글자 (확정 + 아직 바뀔 수 있는 글자)
  let userStopped = false
  let finished = false
  let silent = 0 // 아무 말도 없이 끝난 구간이 연달아 몇 번인지
  let sessions = 0
  let lastError = '' // 이 구간에서 받은 오류 (멈춘 이유를 알리기 위해)
  let rec: WebRecognition | null = null
  let timer: number | undefined

  const text = () => merge(committed, current)

  const finish = (report: boolean, why?: string) => {
    if (finished) return
    finished = true
    window.clearTimeout(timer)
    const r = rec
    rec = null
    if (r) { r.onresult = null; r.onerror = null; r.onend = null; r.onstart = null; try { r.abort() } catch { /* 이미 끝났다 */ } }
    if (report) h.onEnd(text(), why)
  }

  const begin = () => {
    const r = new Ctor()
    rec = r
    sessions++
    r.lang = 'ko-KR'
    r.continuous = true // 끄면 안드로이드 브라우저가 첫 마디에서 바로 끝내 버린다
    r.interimResults = true
    finals = ''
    current = ''
    lastError = ''
    r.onstart = null
    r.onresult = (e) => {
      if (r !== rec) return // 이미 지난 구간의 뒤늦은 결과
      // 확정된 결과는 겹치지 않게 모으고, 아직 바뀔 수 있는 결과는 마지막 것만 쓴다
      // (안드로이드는 결과 목록에 앞 글자를 되풀이해 담으므로 그대로 이어 붙이면 같은 말이 두 번 적힌다)
      let done = ''
      let interim = ''
      for (let i = 0; i < e.results.length; i++) {
        const item = e.results[i]
        const t = item[0]?.transcript ?? ''
        if (item.isFinal) done = merge(done, t)
        else interim = t
      }
      finals = merge(finals, done)
      current = merge(finals, interim)
      h.onText(text())
    }
    r.onerror = (e) => {
      if (r !== rec) return
      lastError = e.error
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        // 다시 듣는 중에 막혔으면 지금까지 들은 글자는 살린다
        if (sessions > 1) { finish(true, `브라우저가 다시 듣기를 막았습니다 (${e.error}, ${sessions}번째 구간)`); return }
        finish(false)
        h.onError('마이크 사용을 허용해 주세요. (주소창 왼쪽 자물쇠 → 마이크 허용)')
      } else if (e.error === 'audio-capture') {
        finish(false)
        h.onError('마이크를 찾지 못했습니다. 마이크가 연결되어 있는지 확인해 주세요.')
      }
      // 그 밖의 오류(no-speech · aborted · network 등)는 곧 onend 가 오므로 거기서 이어 듣거나 끝낸다
    }
    r.onend = () => {
      if (r !== rec || finished) return
      const heard = current.trim() !== ''
      committed = text()
      current = ''
      silent = heard ? 0 : silent + 1
      if (userStopped) { finish(true); return }
      if (Date.now() - startedAt >= MAX_LISTEN_MS) { finish(true, '5분이 지났습니다'); return }
      if (silent >= SILENT_SESSIONS) { finish(true, `한동안 말소리가 없었습니다 (${sessions}번째 구간${lastError ? ` · ${lastError}` : ''})`); return }
      // 말이 잠깐 끊겨 멈춘 것이면 잠시 뒤 이어서 듣는다. 시작이 실패하면 몇 번 더 시도한다
      restart(0)
    }
    r.start()
  }

  const restart = (attempt: number) => {
    timer = window.setTimeout(() => {
      if (finished) return
      try {
        begin()
      } catch (x) {
        if (attempt + 1 < RESTART_TRIES) restart(attempt + 1)
        else finish(true, `다시 듣기 시작 실패 (${sessions}번째 구간): ${x instanceof Error ? x.message : String(x)}`)
      }
    }, attempt === 0 ? 0 : RESTART_DELAY_MS * attempt) // 첫 재시작은 바로 — 말이 새는 틈을 줄인다
  }

  try {
    begin()
  } catch (x) {
    finished = true
    throw new Error(`음성 인식을 시작하지 못했습니다. ${x instanceof Error ? x.message : ''}`.trim())
  }
  return {
    stop: () => {
      userStopped = true
      const r = rec
      if (r) { try { r.stop() } catch { finish(true) } } else finish(true)
      // stop() 뒤에 onend 가 안 오는 브라우저를 위해 잠시 뒤 직접 끝낸다
      window.setTimeout(() => finish(true), 2500)
    },
    cancel: () => { userStopped = true; finish(false) },
  }
}

async function listenNative(h: ListenHandlers): Promise<Listening> {
  let perm = await NativeSpeech.checkPermissions()
  if (perm.speechRecognition !== 'granted') perm = await NativeSpeech.requestPermissions()
  if (perm.speechRecognition !== 'granted') {
    throw new Error('마이크 권한이 필요합니다. 휴대폰 설정 → 앱 → 돌봄 근무일지 → 권한에서 마이크를 허용해 주세요.')
  }
  const { available } = await NativeSpeech.available()
  if (!available) {
    throw new Error('이 휴대폰에서 음성 인식을 쓸 수 없습니다. 「Google」 앱(음성 인식)이 설치 · 사용 중인지 확인해 주세요.')
  }

  /**
   * 안드로이드 음성 인식의 순서: 말이 끊기면 listeningState:stopped 가 먼저 오고,
   * 그 뒤(보통 0.5초 안)에 최종 글자가 partialResults 로 한 번 더 온다.
   * stopped 가 오자마자 글자를 확정하고 다시 들으면 뒤늦게 온 최종 글자가 새 구간의 글자로 붙어
   * 같은 말이 두 번 적히므로, 잠시 기다려 최종 글자까지 받은 다음 구간을 확정한다.
   */
  const FINAL_WAIT_MS = 900
  /** 다시 듣기 시작 직후 이 시간 안에 온 글자는 앞 구간의 최종 글자로 본다 */
  const LATE_FINAL_MS = 1500

  const startedAt = Date.now()
  let committed = '' // 앞서 끝난 구간들의 글자
  let previous = '' // 바로 앞 구간의 글자 (뒤늦게 온 최종 글자로 바꿔 넣기 위해)
  let current = '' // 지금 구간의 글자
  let userStopped = false
  let finished = false
  let settle: number | undefined
  let restartedAt = 0
  let silent = 0
  const handles: PluginListenerHandle[] = []

  const text = () => merge(committed, current)

  const finish = (report: boolean, why?: string) => {
    if (finished) return
    finished = true
    window.clearTimeout(settle)
    handles.forEach((x) => void x.remove())
    void NativeSpeech.stop().catch(() => undefined)
    if (report) h.onEnd(text(), why)
  }

  const begin = async () => {
    try {
      await NativeSpeech.start({ language: 'ko-KR', partialResults: true, popup: false, maxResults: 1 })
    } catch (x) {
      // 들은 글자가 있으면 그것으로 끝내고, 처음부터 실패했으면 알린다
      const reason = x instanceof Error ? x.message : String(x)
      if (text()) finish(true, `다시 듣기 시작 실패: ${reason}`)
      else { finish(false); h.onError(`음성 인식을 시작하지 못했습니다. ${reason}`.trim()) }
    }
  }

  /** 한 구간이 끝났다 — 최종 글자를 기다린 뒤, 말이 있었고 사용자가 끝내지 않았으면 이어서 듣는다 */
  const segmentEnded = () => {
    window.clearTimeout(settle)
    settle = window.setTimeout(() => {
      if (finished) return
      const heard = current.trim() !== ''
      silent = heard ? 0 : silent + 1
      if (userStopped) { finish(true); return }
      if (Date.now() - startedAt >= MAX_LISTEN_MS) { finish(true, '5분이 지났습니다'); return }
      if (silent >= SILENT_SESSIONS) { finish(true, '한동안 말소리가 없었습니다'); return }
      previous = current.trim()
      committed = text()
      current = ''
      restartedAt = Date.now()
      void begin()
    }, FINAL_WAIT_MS)
  }

  handles.push(
    await NativeSpeech.addListener('partialResults', (d) => {
      const match = (d.matches?.[0] ?? '').trim()
      if (!match || finished) return
      if (!current && previous && Date.now() - restartedAt < LATE_FINAL_MS
        && (match.startsWith(previous) || previous.startsWith(match))) {
        // 다시 듣기 직후 온 앞 구간의 최종 글자 — 새 구간이 아니라 앞 구간을 다듬은 것이므로 바꿔 넣는다
        committed = merge(committed.slice(0, committed.length - previous.length), match)
        previous = match
        h.onText(text())
        return
      }
      current = match
      h.onText(text())
    }),
    await NativeSpeech.addListener('listeningState', (d) => {
      if (d.status !== 'stopped' || finished) return
      segmentEnded()
    }),
  )

  await begin()
  return {
    stop: () => {
      userStopped = true
      // 멈추면 listeningState:stopped → 최종 글자 순서로 오고 그때 끝난다. 안 오는 기기를 위해 잠시 뒤 직접 끝낸다
      void NativeSpeech.stop().catch(() => undefined)
      window.setTimeout(() => finish(true), FINAL_WAIT_MS + 1500)
    },
    cancel: () => { userStopped = true; finish(false) },
  }
}

// ─── 2. 글자 → 칸 ────────────────────────────────────────────────────────────

/** new = 빈 칸에 새로 쓰기, supplement = 이미 적힌 내용을 보완하기 */
export type VoiceMode = 'new' | 'supplement'

export const CONTENT_KEYS: (keyof CareFields)[] = ['start_time', 'end_time', 'client_name', 'work_done', 'special_note']

export const hasContent = (d: CareDraft) => CONTENT_KEYS.some((k) => d[k].trim() !== '')

/** AI 가 연결돼 있으면 칸별로 정리하고, 아니면(체험 화면 포함) 말한 내용을 「한 일」에 넣는다 */
export async function fillCareByVoice(
  transcript: string, draft: CareDraft, mode: VoiceMode, aiConnected: boolean,
): Promise<CareFields> {
  if (DEMO || !aiConnected) return plainFill(transcript, draft, mode)
  return voiceFillCare(transcript, draft, mode)
}

function plainFill(transcript: string, draft: CareDraft, mode: VoiceMode): CareFields {
  const { log_date: _date, ...fields } = draft
  const work = draft.work_done.trim()
  return { ...fields, work_done: mode === 'supplement' && work ? `${work}\n${transcript}` : transcript }
}
