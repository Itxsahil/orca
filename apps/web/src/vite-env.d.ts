/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Full API origin when the web app is not served behind the same origin as the API. */
  readonly VITE_API_URL?: string;
}
