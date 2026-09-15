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
  /** 끝났을 때 최종 글자 (cancel 이면 부르지 않는다) */
  onEnd: (text: string) => void
  onError: (message: string) => void
}

/** 음성 인식은 말이 잠깐 끊기면 저절로 멈추므로, 사용자가 끝낼 때까지 이어서 다시 듣는다 (최대 5분) */
const MAX_LISTEN_MS = 5 * 60 * 1000

type WebRecognition = {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
}

const webRecognitionCtor = (): (new () => WebRecognition) | null => {
  const w = window as unknown as Record<string, unknown>
  return (w.SpeechRecognition || w.webkitSpeechRecognition || null) as (new () => WebRecognition) | null
}

/** 이 기기에서 말로 입력할 수 있는지 */
export const canListen = (): boolean => Capacitor.isNativePlatform() || webRecognitionCtor() !== null

export const LISTEN_UNSUPPORTED =
  '이 브라우저에서는 음성 입력을 쓸 수 없습니다. PC 에서는 크롬이나 엣지로 열어 주세요.'

const join = (a: string, b: string) => [a.trim(), b.trim()].filter(Boolean).join(' ')

export async function startListening(h: ListenHandlers): Promise<Listening> {
  return Capacitor.isNativePlatform() ? listenNative(h) : listenWeb(h)
}

function listenWeb(h: ListenHandlers): Listening {
  const Ctor = webRecognitionCtor()
  if (!Ctor) throw new Error(LISTEN_UNSUPPORTED)

  const startedAt = Date.now()
  let committed = '' // 앞서 끝난 구간들의 글자
  let current = '' // 지금 구간의 글자
  let userStopped = false
  let cancelled = false
  let rec: WebRecognition

  const text = () => join(committed, current)

  const begin = () => {
    rec = new Ctor()
    rec.lang = 'ko-KR'
    rec.continuous = true
    rec.interimResults = true
    rec.onresult = (e) => {
      let s = ''
      for (let i = 0; i < e.results.length; i++) s += e.results[i][0].transcript
      current = s
      h.onText(text())
    }
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return // 조용했을 뿐 — 다시 듣거나 끝낸다
      userStopped = true
      const message =
        e.error === 'not-allowed' || e.error === 'service-not-allowed'
          ? '마이크 사용을 허용해 주세요. (주소창 왼쪽 자물쇠 → 마이크 허용)'
          : e.error === 'audio-capture'
            ? '마이크를 찾지 못했습니다. 마이크가 연결되어 있는지 확인해 주세요.'
            : e.error === 'network'
              ? '음성 인식에 인터넷 연결이 필요합니다.'
              : `음성 인식 오류 (${e.error})`
      cancelled = true
      h.onError(message)
    }
    rec.onend = () => {
      if (cancelled) return
      committed = text()
      current = ''
      if (!userStopped && Date.now() - startedAt < MAX_LISTEN_MS) {
        try { begin(); return } catch { /* 다시 못 들으면 여기서 끝낸다 */ }
      }
      h.onEnd(committed)
    }
    rec.start()
  }

  begin()
  return {
    stop: () => { userStopped = true; rec.stop() },
    cancel: () => { userStopped = true; cancelled = true; rec.abort() },
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
   * 그래서 stopped 가 오자마자 글자를 확정하고 다시 들으면, 뒤늦게 온 최종 글자가
   * 새 구간의 글자로 붙어 같은 말이 두 번 적히고 시작음도 그때마다 울렸다.
   * → stopped 뒤에는 잠시 기다려 최종 글자까지 받은 다음 구간을 확정한다.
   */
  const FINAL_WAIT_MS = 900

  const startedAt = Date.now()
  let committed = ''
  let current = ''
  let userStopped = false
  let finished = false
  let settle: number | undefined
  let restartedAt = 0
  const handles: PluginListenerHandle[] = []

  const text = () => join(committed, current)

  const finish = (report: boolean) => {
    if (finished) return
    finished = true
    window.clearTimeout(settle)
    handles.forEach((x) => void x.remove())
    void NativeSpeech.stop().catch(() => undefined)
    if (report) h.onEnd(text())
  }

  const begin = async () => {
    try {
      await NativeSpeech.start({ language: 'ko-KR', partialResults: true, popup: false, maxResults: 1 })
    } catch (x) {
      // 들은 글자가 있으면 그것으로 끝내고, 처음부터 실패했으면 알린다
      if (text()) finish(true)
      else { finish(false); h.onError(`음성 인식을 시작하지 못했습니다. ${x instanceof Error ? x.message : ''}`.trim()) }
    }
  }

  /** 한 구간이 끝났다 — 최종 글자를 기다린 뒤, 사용자가 끝내지 않았으면 이어서 듣는다 */
  const segmentEnded = () => {
    window.clearTimeout(settle)
    settle = window.setTimeout(() => {
      if (finished) return
      if (userStopped || Date.now() - startedAt >= MAX_LISTEN_MS) { finish(true); return }
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
      // 다시 듣기 직후, 앞 구간의 최종 글자가 뒤늦게 한 번 더 오면(이미 확정한 글자와 같으면) 무시한다
      if (!current && Date.now() - restartedAt < 1500 && committed.endsWith(match)) return
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
