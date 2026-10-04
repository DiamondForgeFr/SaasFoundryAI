/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The product name your users read (`.env`); the project name by default. */
  readonly VITE_APP_NAME?: string
}

interface ImportMeta {
  glob: (path: string, options?: { eager: boolean; query?: string; import?: string }) => Record<string, string>
}
