import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { AppProvider } from './state/AppContext'
import './styles.css'
import { Capacitor } from '@capacitor/core'
import { App as NativeApp } from '@capacitor/app'

// 안드로이드 앱: 뒤로가기 버튼은 열린 창을 먼저 닫고, 창이 없으면 앱을 내린다
if (Capacitor.isNativePlatform()) {
  void NativeApp.addListener('backButton', () => {
    const close = document.querySelector<HTMLButtonElement>('.modal-close')
    if (close) close.click()
    else void NativeApp.minimizeApp()
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </React.StrictMode>,
)
