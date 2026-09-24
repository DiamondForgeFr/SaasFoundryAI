# Module PWA — application installable

## Vue d'ensemble

Ce module rend l'application web générée installable comme une **application de bureau**. Chrome, Brave et Edge proposent « Installer cette application » puis l'ouvrent dans sa propre fenêtre, sans
barre d'adresse ni onglets, avec une icône dans le Dock ou la barre des tâches.

Il s'appuie sur les standards du Web — Web App Manifest et service worker — et permet également l'ajout à l'écran d'accueil mobile.

**Activé par défaut**, il reste optionnel : certains produits ne doivent pas être installables.

## Fichiers installés

| Fichier                                     | Rôle                                                       |
| ------------------------------------------- | ---------------------------------------------------------- |
| `pwa.config.ts`                             | Configuration PWA séparée de `vite.config.ts`              |
| `public/pwa-192x192.png`, `pwa-512x512.png` | Tailles requises par Chromium pour proposer l'installation |
| `public/pwa-maskable-512x512.png`           | Icône Android avec zone de sécurité                        |
| `public/apple-touch-icon.png`               | Icône de l'écran d'accueil iOS                             |

Le module ajoute aussi `vite-plugin-pwa`, l'enregistre dans `vite.config.ts` et ajoute la balise `theme-color` à `index.html`.

## Installation

Les nouveaux projets l'incluent :

```bash
sf new
```

Pour le refuser ou l'ajouter plus tard :

```bash
sf new --no-pwa
sf update --add-modules pwa
```

## Remplacer l'icône

Les PNG fournis utilisent la marque SaaSFoundryAI comme placeholder. Remplacez les quatre images de `public/` sans changer leurs tailles ni leurs noms.

L'icône maskable doit garder une marge réelle : Android recadre dans un cercle d'environ 80 % du carré. Faites occuper environ 60 % du canevas à votre symbole.

## Fonctionnement hors ligne

Le mode hors ligne concerne uniquement le **shell**. Les assets construits sont précachés, mais les appels API restent réseau uniquement. La synchronisation de données hors ligne touche à
l'architecture de l'API et reste volontairement hors périmètre.

## Trois réglages importants

### `registerType: 'autoUpdate'`

Une application installée prend automatiquement la nouvelle version au prochain chargement. Le réglage `prompt` par défaut du plugin pourrait maintenir un ancien build tant que l'utilisateur n'accepte
pas la mise à jour.

### `cleanupOutdatedCaches: true`

Les anciens précaches sont supprimés au lieu de s'accumuler à chaque livraison.

### `navigateFallbackDenylist: [/^\/api\//]`

Le service worker ne répond jamais à une requête API avec le `index.html` de la SPA. Sans cette exclusion, le réseau pourrait afficher `200 OK` alors que le parseur JSON reçoit du HTML.

## Vérification

Après `npm run build`, `dist/` doit contenir `manifest.webmanifest`, `sw.js`, `registerSW.js` et les icônes.

Servez le build en **HTTPS ou sur localhost** : les service workers sont refusés sur un HTTP classique. Chrome DevTools → _Application_ → _Manifest_ liste les éléments manquants et le navigateur doit
proposer l'installation.

## Suppression

Supprimez `pwa.config.ts`, les icônes `public/pwa-*.png`, l'import et l'appel `VitePWA` dans `vite.config.ts`, la dépendance `vite-plugin-pwa` et `modules.pwa` dans `.saasfoundry.json`.

Une application déjà installée conserve son ancien service worker jusqu'à son désenregistrement. Livrez un `sw.js` vide si vous devez provoquer son éviction.
