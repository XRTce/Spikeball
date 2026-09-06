import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

const BRAND = '#FF6B2C';
const INK = '#0B1220';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: 'es2020',
    cssCodeSplit: false,
    reportCompressedSize: true,
    rollupOptions: {
      output: {
        // Keep the vendor runtime in its own long-lived chunk so app updates
        // only invalidate a small file for returning users.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('dexie')) return 'vendor-db';
          return 'vendor';
        },
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png', 'robots.txt'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        clientsClaim: true,
      },
      devOptions: { enabled: false },
      manifest: {
        id: '/',
        name: 'Rally - Roundnet Turniere',
        short_name: 'Rally',
        description:
          'Turniere, Spielergebnisse und Elo-Wertungen fuer Roundnet - offline, ohne Account.',
        lang: 'de',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        display_override: ['window-controls-overlay', 'standalone'],
        orientation: 'portrait',
        background_color: INK,
        theme_color: INK,
        categories: ['sports', 'utilities', 'productivity'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Neues Turnier', short_name: 'Neu', url: '/tournament/new' },
          { name: 'Turniere', short_name: 'Turniere', url: '/' },
        ],
      },
    }),
  ],
});
