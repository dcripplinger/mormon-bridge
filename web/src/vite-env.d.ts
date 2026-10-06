/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AI_DEBUG?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
