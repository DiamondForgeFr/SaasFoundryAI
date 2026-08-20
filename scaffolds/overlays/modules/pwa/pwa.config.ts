import type { VitePWAOptions } from 'vite-plugin-pwa'

/**
 * PWA options, kept out of `vite.config.ts` so enabling the module is a two-line edit there
 * (one import, one plugin call) rather than a large inline block.
 *
 * Installing this module makes the app installable through the browser's own flow — Chrome,
 * Brave and Edge offer "Install this application", which opens it in its own window, with no
 * browser chrome and a Dock/taskbar icon. That is a web-standards capability (Web App Manifest
 * + service worker), not a proprietary API, so it also covers mobile home screens.
 */
export const pwaOptions: Partial<VitePWAOptions> = {
  // `autoUpdate` is deliberate. With the default `prompt` strategy an installed app keeps
  // serving the build it was installed with until the user accepts an update — a deploy then
  // looks broken to everyone who installed the app, and only to them. This is the classic PWA
  // production failure, so the service worker takes over immediately and the next load is fresh.
  registerType: 'autoUpdate',

  // The icons live in `public/`, so they are copied verbatim into the build output.
  includeAssets: ['img/icon.svg', 'apple-touch-icon.png'],

  manifest: {
    // Replaced at install time with the project's own name.
    name: '{{PROJECT_NAME}}',
    short_name: '{{PROJECT_NAME}}',
    description: '{{PROJECT_DESCRIPTION}}',
    // `standalone` is what removes the browser chrome — without it the installed app is just a
    // tab in a bare window, which is not what "desktop app" means to anyone.
    display: 'standalone',
    start_url: '/',
    scope: '/',
    // Tints the window title bar. Matches the app's `--primary`.
    theme_color: '#F97316',
    // Splash background while the app boots. Matches the light theme's `--background`.
    background_color: '#FAF7F2',
    icons: [
      { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
      { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
      // Android crops icons to a circle of 80% diameter. Without a maskable variant carrying
      // its own safe-zone padding, the mark gets clipped.
      { src: 'pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  },

  workbox: {
    // Precache the built shell. Everything the app needs to start offline, nothing more —
    // true offline with a sync story reaches into the API layer and is a separate concern.
    globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],

    // Without this, superseded precaches accumulate in the user's browser build after build.
    cleanupOutdatedCaches: true,

    // Claim open tabs straight away, so an update does not wait for every tab to close.
    clientsClaim: true,
    skipWaiting: true,

    // A single-page app serves every route from index.html.
    navigateFallback: '/index.html',
    // ...except the API, which must never be answered from the app shell. Serving a cached
    // index.html in place of a JSON response is a confusing failure to debug.
    navigateFallbackDenylist: [/^\/api\//]
  },

  devOptions: {
    // Off by default: a service worker in dev caches aggressively and makes HMR behave
    // erratically. Flip this on only to debug the PWA itself.
    enabled: false
  }
}
