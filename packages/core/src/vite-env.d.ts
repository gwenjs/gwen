/// <reference types="vite/client" />

/**
 * Vite environment variables type augmentation.
 * Allows TypeScript to understand import.meta.env.DEV/PROD and other Vite env vars.
 */
interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
