/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

interface ImportMetaEnv {
  /**
   * Origin of the sync server, e.g. `https://rally.example.com`. Unset means
   * the same origin that serves the app (the Docker image serves both).
   */
  readonly VITE_SYNC_URL?: string;
}

declare module '*.module.css' {
  const classes: Record<string, string>;
  export default classes;
}
