import { Capacitor } from '@capacitor/core'
import { organizeWithAi } from './ai'
import type { CareDraft, CareFields } from './types'

/**
 * 받아쓴 글 → 일지 칸
 *
 * 말 → 글자는 휴대폰 키보드의 마이크(음성 입력)가 맡는다. 브라우저 자체 음성 인식(Web Speech API)은
 * 안드로이드에서 말이 잠깐 끊길 때마다 멈추고 다시 시작하는 사이의 말이 새서 쓰지 않는다.
 * 글자 → 칸은 설정에서 AI 를 연결했을 때 Claude 가 장소 · 한 일 · 특이사항을 나눠 채운다 (lib/ai.ts).
 */

/** 휴대폰 · 태블릿 (안내 문구에 "키보드의 마이크"를 쓸지) */
export const IS_MOBILE = Capacitor.isNativePlatform() || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

/** new = 빈 칸에 새로 쓰기, supplement = 이미 적힌 내용을 살리면서 보완하기 */
export type OrganizeMode = 'new' | 'supplement'

export const CONTENT_KEYS: (keyof CareFields)[] = ['client_name', 'work_done', 'special_note']

export const hasContent = (d: CareDraft) => CONTENT_KEYS.some((k) => d[k].trim() !== '')

/** 「한 일」에 받아쓴 글(transcript)을 AI 가 칸별로 나눈다. draft 는 「한 일」을 비운 지금 칸 내용 */
export function organizeCare(transcript: string, draft: CareDraft, mode: OrganizeMode): Promise<CareFields> {
  return organizeWithAi(transcript, draft, mode)
}
