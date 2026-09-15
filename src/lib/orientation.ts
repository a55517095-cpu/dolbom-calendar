import { useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { ScreenOrientation } from '@capacitor/screen-orientation'

/**
 * 휴대폰 가로 보기 — 좁은 세로 화면에서는 달력을 좌우로 밀어야 하므로,
 * 버튼으로 화면을 가로로 돌려 7일을 한눈에 본다.
 *
 * - 안드로이드 앱: 화면 방향 플러그인으로 돌린다 (휴대폰 자동 회전이 꺼져 있어도 된다)
 * - 휴대폰 브라우저: 전체 화면으로 바꾼 뒤 방향을 고정한다 (크롬 · 삼성 인터넷)
 * - 방향 고정을 못 하는 브라우저(아이폰 사파리 · PC)는 휴대폰을 직접 돌리도록 안내한다
 */

export const ROTATE_UNSUPPORTED =
  '이 브라우저에서는 버튼으로 화면을 돌릴 수 없습니다. 휴대폰 자동 회전을 켜고 휴대폰을 가로로 돌려 주세요.'

type WebOrientation = { lock?: (orientation: string) => Promise<void>; unlock?: () => void }
const webOrientation = () => (screen.orientation as unknown as WebOrientation | undefined)

export async function turnLandscape(): Promise<void> {
  if (Capacitor.isNativePlatform()) return ScreenOrientation.lock({ orientation: 'landscape' })

  const orientation = webOrientation()
  if (!orientation?.lock) throw new Error(ROTATE_UNSUPPORTED)
  try {
    // 브라우저는 전체 화면일 때만 방향 고정을 허락한다
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' })
    }
    await orientation.lock('landscape')
  } catch {
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined)
    throw new Error(ROTATE_UNSUPPORTED)
  }
}

export async function turnPortrait(): Promise<void> {
  if (Capacitor.isNativePlatform()) return ScreenOrientation.lock({ orientation: 'portrait' })

  try {
    webOrientation()?.unlock?.()
  } catch {
    /* 고정한 적이 없으면 풀 것도 없다 */
  }
  if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined)
}

const LANDSCAPE = '(orientation: landscape)'

/** 지금 화면이 가로인지 (돌리면 바로 바뀐다) */
export function useLandscape(): boolean {
  const [landscape, setLandscape] = useState(() => window.matchMedia(LANDSCAPE).matches)
  useEffect(() => {
    const query = window.matchMedia(LANDSCAPE)
    const update = () => setLandscape(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return landscape
}
