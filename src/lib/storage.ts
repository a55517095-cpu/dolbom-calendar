// 브라우저 저장소는 개인정보 보호 모드 등에서 막힐 수 있으므로 실패해도 앱이 멈추지 않게 한다

export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* 저장 못 해도 이번 접속에는 문제없다 */
  }
}
