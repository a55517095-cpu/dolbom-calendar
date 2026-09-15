/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_LOGIN_EMAIL_DOMAIN?: string
  readonly VITE_PIN_PEPPER?: string
  readonly VITE_SCHEDULE_URL?: string
  readonly VITE_OWNER_NAME?: string
  readonly VITE_SHEET_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
