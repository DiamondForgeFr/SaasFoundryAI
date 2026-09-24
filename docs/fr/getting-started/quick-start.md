# Votre fondation SaaS en environ 60 secondes

Commencez avec un monorepo conçu pour la production au lieu de passer votre premier sprint à connecter authentification, tenants, permissions, API, frontend et outils de livraison.

SaaSFoundry génère la fondation et enregistre chaque choix dans un contrat de projet unique. Le code vous appartient : étendez-le, remplacez certaines parties et déployez-le sur votre infrastructure.

::: tip Ce que signifie « 60 secondes »

En une minute environ, vous pouvez choisir la forme du produit et lancer la génération. Le CLI installe ensuite les dépendances et initialise le projet ; cette attente finale varie selon votre machine
et votre réseau.

:::

## Avant de commencer

Il vous faut Node.js 24.19.0 ou plus récent, npm 11, Git et Docker pour la configuration PostgreSQL locale recommandée. Le [guide d'installation](/fr/getting-started/installation) couvre les dépôts
existants, l'installation globale et les profils d'agents pris en charge.

## 1. Lancez le créateur

Aucune installation globale n'est nécessaire :

```bash
npx saasfoundryai-cli@beta new
```

Vous préférez une conversation guidée par l'IA ? Le guide [Installation par CLI ou assistant](/fr/getting-started/setup-paths) explique les deux parcours. Ils utilisent le même moteur de configuration
et produisent le même contrat géré.

## 2. Choisissez la forme

Pour un nouveau produit, choisissez ces valeurs par défaut dans le parcours interactif :

```text
Profil            Full — fondation SaaS + harness de développement
Structure         Monorepo (recommandé)
Dépôt             Local
Base de données   PostgreSQL avec Docker
E-mail            Aucun pour le moment
Stockage          Manuel pour le moment
Analytics         Non
```

`full` réunit les deux piliers de SaaSFoundry. Choisissez `stack` si vous ne voulez que la fondation technique, ou `harness` pour ajouter le système de livraison à un code que vous conservez.

::: info Optionnel signifie optionnel

Les modules E-mail MailerSend, stockage S3, Analytics, PWA, centralisation SRS et les skills d'outils externes sont des capacités sélectionnées. Vous pouvez ajouter plus tard les modules compatibles
avec `sf update` ; ils ne sont pas activés silencieusement dans chaque projet.

:::

## 3. Démarrez le projet

Entrez dans le dossier généré, démarrez ses services locaux, initialisez la base de données puis lancez les deux applications :

```bash
cd my-saas
npm run services:up
npm run db:setup:dev
npm run dev
```

Ouvrez les deux surfaces locales :

- Application web : [http://localhost:5173](http://localhost:5173)
- API et documentation générée : [http://localhost:3500/api/docs](http://localhost:3500/api/docs)

Le CLI sélectionne les premiers ports disponibles lorsque les valeurs par défaut sont déjà occupées. Son résumé final et `.saasfoundry.json` restent la référence.

## Ce que vous venez d'obtenir

Votre nouveau dépôt est déjà connecté du navigateur à l'API et à la base de données :

1. **Authentification et sessions** — inscription, connexion, déconnexion, confirmation et réinitialisation avec JWT, Passport, jetons de renouvellement et cookies `httpOnly`.
2. **Un vrai modèle tenant** — plateforme, comptes clients, organisations et entités imbriquées plutôt qu'un schéma de démonstration mono-utilisateur.
3. **RBAC contextualisé** — rôles de plateforme, compte et entité avec modules, sections visibles et permissions d'action. [Explorer le RBAC](/fr/features/rbac).
4. **Opérations de compte** — membres, invitations, rôles personnalisés, désactivation et réactivation déjà représentés dans l'API et l'interface.
5. **Une chaîne d'API typée** — les contrats NestJS et Zod génèrent OpenAPI et, en monorepo, un client API réutilisable avec des hooks React Query.
6. **Une application React moderne** — React Router, Tailwind CSS, primitives Radix/de style ShadCN, React Query et React Hook Form déjà connectés.
7. **Des ressources d'interface anglaises et françaises** — i18next et des espaces de noms YAML initialisés pour les surfaces générées.
8. **PostgreSQL du développement à la production** — Prisma avec l'adaptateur PostgreSQL, des schémas par domaine, contraintes, triggers et données initiales.
9. **Des valeurs par défaut pour la qualité et la production** — ESLint, Prettier, tests unitaires/E2E/navigateur, hooks Git, images Docker multi-stage, Nginx, health checks et logs structurés.
10. **Un harness de livraison IA** — le profil `full` ajoute le manifeste, les skills du projet, la grammaire d'intégration et le workflow gardé qui relie les agents à votre board et aux règles du
    dépôt.

Consultez l'[inventaire complet des capacités](/fr/features/built-in) pour les extraits de code, les modules optionnels et les liens vers chaque guide détaillé.

## Votre prochaine étape

::: info Construisez et inspectez le premier parcours réel

Continuez avec [Votre premier projet SaaS](/fr/getting-started/first-project). Ce tutoriel couvre la structure générée, les services locaux, la création de compte, la documentation API et votre
première fonctionnalité transverse.

:::

Si vous préférez d'abord le modèle mental, lisez [Monorepo ou multirepo](/fr/guide/monorepo-vs-multirepo) et [Comment fonctionne le workflow](/fr/guide/workflow-system).
