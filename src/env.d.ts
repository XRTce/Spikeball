/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

declare module '*.module.css' {
  const classes: Record<string, string>;
  export default classes;
}
