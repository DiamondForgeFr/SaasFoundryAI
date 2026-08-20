# PWA Module (Installable app)

## Overview

Makes your generated web app installable as a **desktop application**. Chrome, Brave and Edge offer _"Install this application"_, which opens it in its own window — no address bar, no tabs — with a
Dock or taskbar icon, exactly like a native app.

This is a web-standards capability (Web App Manifest + service worker), not a proprietary browser API, so the same module also puts the app on a mobile home screen.

**On by default.** It is still a real module you can decline: some products should not be installable, and that is a choice you make rather than something you strip out afterwards.

## What gets installed

| File                                        | Purpose                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------- |
| `pwa.config.ts`                             | The PWA options, kept out of `vite.config.ts` so the wiring stays two lines     |
| `public/pwa-192x192.png`, `pwa-512x512.png` | The sizes Chromium requires before it offers installation at all                |
| `public/pwa-maskable-512x512.png`           | Android crops icons to a circle; this variant carries its own safe-zone padding |
| `public/apple-touch-icon.png`               | iOS home screen                                                                 |

Plus: `vite-plugin-pwa` added to your dev dependencies, the plugin registered in `vite.config.ts`, and a `theme-color` meta tag in `index.html`.

## Installation

Nothing to do — new projects get it:

```bash
sf new
```

To decline it:

```bash
sf new --no-pwa
```

To add it to a project that does not have it yet:

```bash
sf update --add-modules pwa
```

## Swapping the icon

The icons are generated from the SaaSFoundryAI mark as a placeholder. Replace the four PNGs in `public/` with your own at the same sizes and filenames.

Keep the maskable variant genuinely padded: Android crops it to a circle of 80% diameter, so artwork that fills the canvas loses its edges. Aim for the mark occupying roughly 60% of the square.

## Offline behaviour

**Shell-only.** The built assets are precached so the app starts without a network, and API calls always go to the network. There is no offline data layer and no sync story — that reaches into your
API design and is deliberately out of scope.

## Three settings that are not the plugin defaults

These are set for you, and each one prevents a specific production failure.

### `registerType: 'autoUpdate'`

With the plugin's default (`prompt`), an installed app keeps serving the build it was installed with until the user accepts an update. **Your next deploy then looks broken to exactly the people who
installed your app** — and only to them, which makes it miserable to diagnose. `autoUpdate` takes the new build on the next load.

### `cleanupOutdatedCaches: true`

Without it, superseded precaches accumulate in your users' browsers, build after build.

### `navigateFallbackDenylist: [/^\/api\//]`

A single-page app serves every route from `index.html`. Without this exclusion the service worker would answer API calls with your HTML shell — a confusing failure where the network tab shows `200 OK`
and the JSON parser throws.

## Verifying it works

After `npm run build`, `dist/` should contain `manifest.webmanifest`, `sw.js`, `registerSW.js` and the icons.

Then serve the build over **HTTPS or localhost** — service workers are refused on plain HTTP — and look for the install affordance in the address bar. Chrome DevTools → _Application_ → _Manifest_
reports anything it considers missing.

## Removing it

Delete `pwa.config.ts` and the `public/pwa-*.png` icons, remove the `VitePWA` import and plugin call from `vite.config.ts`, drop `vite-plugin-pwa` from `package.json`, and remove `modules.pwa` from
`.saasfoundry.json`.

Users who already installed your app keep a stale service worker until it unregisters, so ship an empty `sw.js` if you need to actively evict it.
