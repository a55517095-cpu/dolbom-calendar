import type { CapacitorConfig } from '@capacitor/cli'

// 안드로이드 앱(APK) 설정
// 화면은 인터넷의 Vercel 주소를 바로 연다 (웹 주소 연결 방식).
// → 웹을 고쳐 GitHub 에 올리면 앱에도 자동 반영된다. 주소를 바꿀 때만 APK 를 다시 만든다.
// webDir(dist)은 빌드 도구가 요구해서 남겨 둔다.
const config: CapacitorConfig = {
  appId: 'com.dolbom.worklog',
  appName: '돌봄 근무일지',
  webDir: 'dist',
  server: {
    url: 'https://dolbom-calendar.vercel.app',
    cleartext: false,
  },
  android: {
    // 상태표시줄 · 하단 내비게이션 바에 화면이 가려지지 않게
    adjustMarginsForEdgeToEdge: 'auto',
  },
}

export default config
