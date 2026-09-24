# Module Analytics — Umami

Mesure d'audience respectueuse de la vie privée avec Umami.

## Vue d'ensemble

Le module intègre Umami au frontend de votre SaaS :

- ✅ sans cookies et adapté au RGPD ;
- ✅ script léger, sans impact notable sur le rendu ;
- ✅ auto-hébergeable pour garder la maîtrise des données ;
- ✅ visiteurs et événements visibles en temps réel ;
- ✅ script de suivi configuré automatiquement.

Il mesure les pages vues lors des changements de route, les événements métier, les visiteurs, sessions et taux de rebond, sans créer de profil intersites.

## Pourquoi Umami ?

| Critère               | Umami                     | Google Analytics                 |
| --------------------- | ------------------------- | -------------------------------- |
| Vie privée            | Sans cookies              | Consentement généralement requis |
| Propriété des données | Vous, en auto-hébergement | Service Google                   |
| Auto-hébergement      | Oui                       | Non                              |
| Complexité            | Faible                    | Plus élevée                      |

Umami et Plausible sont tous deux open source et modernes. Umami se distingue ici par son intégration prévue dans le générateur et son option auto-hébergée gratuite.

## Options de déploiement

### 1. Auto-hébergement — recommandé

Préparez PostgreSQL ou MySQL, un serveur Node.js et éventuellement un domaine :

```bash
git clone https://github.com/umami-software/umami.git
cd umami
npm install
createdb umami
cp .env.example .env
# DATABASE_URL="postgresql://user:pass@localhost:5432/umami"
npm run build
npm start
```

Dans l'interface Umami, créez le site, renseignez son domaine et copiez son **Website ID**. Fournissez ensuite l'URL du script et cet identifiant à `sf new` ou `sf update`.

### 2. Umami Cloud

Créez le site depuis [Umami Cloud](https://umami.is/pricing), récupérez son Website ID et utilisez :

```env
VITE_ANALYTICS_URL="https://cloud.umami.is/script.js"
VITE_ANALYTICS_WEBSITE_ID="your-website-id"
```

### 3. Docker pour le développement

```yaml
services:
  umami:
    image: ghcr.io/umami-software/umami:postgresql-latest
    ports:
      - '3001:3000'
    environment:
      DATABASE_URL: postgresql://umami:umami@db:5432/umami
      DATABASE_TYPE: postgresql
      APP_SECRET: your-secret-key
    depends_on:
      - db

  db:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: umami
      POSTGRES_USER: umami
      POSTGRES_PASSWORD: umami
    volumes:
      - umami-db:/var/lib/postgresql/data

volumes:
  umami-db:
```

```bash
docker compose up -d
# Interface : http://localhost:3001
```

## Installation

```bash
sf new
# Activer Analytics (Umami), puis fournir l'URL du script et le Website ID.

sf update
# Choisir Analytics (Umami).
```

L'installateur copie la bibliothèque dans `apps/web/src/lib/analytics/`, ajoute les variables `VITE_ANALYTICS_*` et initialise le suivi dans `main.tsx`.

## Utilisation

### Pages vues automatiques

```tsx
import { initAnalytics } from '@/lib/analytics/analytics'

initAnalytics()

<RouterProvider router={router} />
```

Les changements de route sont suivis automatiquement.

### Événements personnalisés

```typescript
import { trackEvent } from '@/lib/analytics/analytics'

trackEvent('signup_clicked', { plan: 'pro' })
trackEvent('form_submitted', { formName: 'contact' })
trackEvent('data_exported', { format: 'csv', records: 100 })
```

Préférez des noms `snake_case`, explicites et stables. Ajoutez uniquement le contexte nécessaire et n'envoyez jamais de donnée sensible.

## Configuration

### Frontend

```env
VITE_ANALYTICS_URL="https://analytics.myapp.com/script.js"
VITE_ANALYTICS_WEBSITE_ID="abc123-def456-ghi789"
```

### Serveur Umami auto-hébergé

```env
DATABASE_URL="postgresql://user:pass@localhost:5432/umami"
APP_SECRET="your-random-secret-key-here"
TRACKER_SCRIPT_NAME="script.js"
```

La bibliothèque générée crée un script `async`/`defer` uniquement lorsque les deux variables frontend sont présentes. `trackEvent` appelle `window.umami.track(name, data)` une fois Umami chargé.

## Lire les métriques

Le tableau de bord affiche :

- visiteurs actuels et pages vues récentes ;
- visiteurs uniques, sessions, rebond, durée et pages par visite ;
- pages, sources, navigateurs, systèmes, appareils, pays et langues ;
- noms, volumes et périodes des événements personnalisés.

En auto-hébergement, ouvrez votre domaine Umami ; dans le cloud, utilisez `https://cloud.umami.is`.

## Vie privée et RGPD

Umami n'utilise pas de cookie et ne suit pas les personnes entre plusieurs sites. Il collecte les URL de page, referrers et informations techniques agrégées. Les adresses IP sont transformées puis
abandonnées ; aucune identité utilisateur ne doit être envoyée.

L'absence de cookies de mesure évite un bandeau uniquement dédié à Umami, mais votre produit reste responsable de ses autres traitements et de sa propre politique de confidentialité.

Exemple de formulation :

```text
Nous utilisons Umami pour comprendre l'utilisation du site. Umami collecte
des données d'usage anonymes, sans cookies ni informations personnelles.
En auto-hébergement, ces données restent sur notre infrastructure.
```

## Performance

Le script pèse environ 2 Ko compressés. Chargez-le avec `async` et `defer`, suivez des événements métier utiles et gardez les payloads petits. Ne bloquez jamais le rendu et ne tracez pas chaque
interaction.

## Usages avancés

### Domaine dédié

```nginx
server {
  listen 80;
  server_name analytics.myapp.com;

  location / {
    proxy_pass http://localhost:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }
}
```

### Renommer le script

```env
# Umami
TRACKER_SCRIPT_NAME="stats.js"

# Application
VITE_ANALYTICS_URL="https://analytics.myapp.com/stats.js"
```

### Environnements séparés

```typescript
const websiteId = import.meta.env.PROD ? 'production-website-id' : 'development-website-id'
script.setAttribute('data-website-id', websiteId)
```

Vous pouvez aussi interrompre `initAnalytics()` lorsque `import.meta.env.DEV` vaut `true`.

## Dépannage

### Aucun événement

1. Vérifiez la présence du script dans la page.
2. Comparez le Website ID au tableau Umami.
3. Ouvrez directement `VITE_ANALYTICS_URL`.
4. Retestez sans bloqueur de contenu.
5. Journalisez temporairement le nom et le payload de `trackEvent`.

### Le tableau reste vide

Attendez une à deux minutes, vérifiez la période, le bon site et qu'il n'est pas en pause.

### Auto-hébergement

```bash
psql postgresql://user:pass@localhost:5432/umami
rm -rf .next node_modules
npm install
npm run build
```

Si le port est occupé, changez `PORT` dans l'environnement.

## Déploiement de production

Utilisez HTTPS, un domaine dédié, un `APP_SECRET` robuste et des sauvegardes quotidiennes de la base. L'image `ghcr.io/umami-software/umami:postgresql-latest` peut être déployée avec PostgreSQL dans
Compose, avec mots de passe fournis par secrets d'environnement.

## Étapes suivantes

- [Module Email](/fr/modules/email)
- [Système de modules](/fr/guide/module-system)
- [Premier projet](/fr/getting-started/first-project)

## Commandes associées

- [`sf new`](/fr/cli/sf-new)
- [`sf update`](/fr/cli/sf-update)

## Ressources

- [Documentation Umami](https://umami.is/docs)
- [Dépôt Umami](https://github.com/umami-software/umami)
- [Umami Cloud](https://cloud.umami.is)
