import type { CapacitorConfig } from '@capacitor/cli'

// 안드로이드 앱(APK) 설정
// 화면은 dist 폴더(npm run build 결과)를 앱 안에 담고, 데이터는 인터넷의 Supabase 를 쓴다.
const config: CapacitorConfig = {
  appId: 'com.dolbom.worklog',
  appName: '돌봄 근무일지',
  webDir: 'dist',
  android: {
    // 상태표시줄 · 하단 내비게이션 바에 화면이 가려지지 않게
    adjustMarginsForEdgeToEdge: 'auto',
  },
}

export default config
