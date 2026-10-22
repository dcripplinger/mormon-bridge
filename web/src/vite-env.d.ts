/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AI_DEBUG?: string
  /** Base URL for the multiplayer worker (http/https). */
  readonly VITE_API_BASE?: string
  /** Public web origin used in share links (defaults to http://localhost:5173). */
  readonly VITE_WEB_ORIGIN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
