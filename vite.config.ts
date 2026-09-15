import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';
import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const INK = '#0B1220';

/**
 * Where the app will be served from.
 *
 * Docker serves it at the domain root; GitHub Pages serves a project site
 * under /<repo>/. Everything that needs the prefix - asset URLs, the router
 * basename, the manifest and the service worker scope - is derived from this
 * one value, so the same source builds for both.
 */
function normalizeBase(value: string | undefined): string {
  if (!value || value === '/') return '/';
  // actions/configure-pages reports base_path without a trailing slash
  // ('/Spikeball'), while Vite wants one. Accept either form: without this,
  // withBase() would emit '/Spikeballicons/icon-192.png'.
  return value.replace(/^\/*/, '/').replace(/\/*$/, '/');
}

const base = normalizeBase(process.env.BASE_PATH);
const withBase = (path: string) => `${base}${path.replace(/^\//, '')}`;

/**
 * GitHub Pages has no SPA rewrite: a deep link like /t/<id> is a 404. Serving
 * a copy of the shell as 404.html makes the browser render the app anyway,
 * and the router then reads the real URL. Once the service worker is active
 * its navigation fallback handles the same job offline.
 */
function spaFallbackPlugin() {
  return {
    name: 'rally-spa-404',
    enforce: 'post' as const,
    closeBundle() {
      const outDir = fileURLToPath(new URL('./dist', import.meta.url));
      const shell = join(outDir, 'index.html');
      if (existsSync(shell)) copyFileSync(shell, join(outDir, '404.html'));
    },
  };
}

export default defineConfig({
  base,
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
    spaFallbackPlugin(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png', 'robots.txt'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        globIgnores: ['**/404.html'],
        navigateFallback: withBase('index.html'),
        cleanupOutdatedCaches: true,
        clientsClaim: true,
      },
      devOptions: { enabled: false },
      manifest: {
        id: base,
        name: 'Rally - Roundnet Turniere',
        short_name: 'Rally',
        description:
          'Turniere, Spielergebnisse und Elo-Wertungen fuer Roundnet - offline, ohne Account.',
        lang: 'de',
        dir: 'ltr',
        start_url: base,
        scope: base,
        display: 'standalone',
        display_override: ['window-controls-overlay', 'standalone'],
        orientation: 'portrait',
        background_color: INK,
        theme_color: INK,
        categories: ['sports', 'utilities', 'productivity'],
        icons: [
          { src: withBase('icons/icon-192.png'), sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: withBase('icons/icon-512.png'), sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: withBase('icons/maskable-192.png'), sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: withBase('icons/maskable-512.png'), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Neues Turnier', short_name: 'Neu', url: withBase('new') },
          { name: 'Turniere', short_name: 'Turniere', url: base },
        ],
      },
    }),
  ],
});
