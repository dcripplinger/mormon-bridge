/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AI_DEBUG?: string
  /** Base URL for the multiplayer worker (http/https). */
  readonly VITE_API_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
