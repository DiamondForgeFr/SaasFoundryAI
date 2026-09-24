# Changelog

Toutes les évolutions notables de SaaSFoundryAI sont consignées ici.

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le projet applique le [versionnage sémantique](https://semver.org/lang/fr/).

## [Non publié]

### Ajouts

#### Commandes CLI

- **`sf modules`** ([#60](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/60)) — `list`, `info` et `match` interrogent le catalogue et classent les intentions par score pondéré.
- **`sf skill`** ([#61](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/61)) — installation, mise à jour et désinstallation des compétences ; `sf uninstall --all` effectue le nettoyage complet.
- **`sf feedback`** ([#62](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/62)) — demande de module, signalement de défaut, liste des propositions et vote communautaire.
- **`sf tools`** — gestion des identifiants multi-comptes pour les services externes.
- **`sf docs`** — serveur local pour la documentation incluse dans le package, utilisable hors ligne.
- **`sf status`** — état du manifeste, des modules et des préconditions sans réinterroger les choix déjà enregistrés.

#### Mode non interactif

- `sf new --non-interactive` expose les options nécessaires au scaffolding scripté ([#58](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/58)).
- `sf update` fournit le dry-run, les stratégies de conflit et l'acceptation explicite des mises à jour de templates ([#59](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/59)).

#### Système de workflow

- Deux presets natifs :
  - **SaaSFoundry**, 7 statuts : `Backlog → Ready → In progress → AI testing → Human testing → In review → Done` ;
  - **SaaSFoundry Solo**, 5 statuts : `Backlog → In progress → AI testing → In review → Done`.
- Création, sauvegarde et réutilisation de workflows personnalisés.
- Quatre niveaux de complexité, avec analyse, approbation, tests et revue contradictoire adaptés au risque.
- Adaptateur GitHub Projects complet, incluant les sous-issues natives et les protections de transition.
- Jira et Linear disponibles à titre expérimental ; Notion fournit le backend SRS v1 complet mais pas un tracker de workflow complet.
- Fermeture progressive des sous-tickets et blocage de la fin du parent tant qu'un enfant reste incomplet ([#79](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/79)).

#### Écosystème de compétences

- **`sf-workflow`** — skill d'orchestration unique, pilotée par le manifeste, compatible Team, Solo et Custom, avec une rigueur adaptée à la complexité.
- **`sf-tool-saasfoundry`** ([#18](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/18)) — prévention de la réinvention, orchestration du feedback et aide aux commandes `sf new` / `sf update`.
- Règles d'intégration partagées pour les modules backend, les pages frontend, les permissions RBAC et les raccordements transverses.
- Schéma de catalogue enrichi ([#60](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/60)).
- Détection du projet et scoring anti-réinvention ([#106](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/106), [#123](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/123)).

#### Infrastructure

- Contrôles pré-commit rapides et validation Docker explicite pendant `AI testing` ([#33](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/33)).
- Couverture Codecov et badge associé.
- Cache local du schéma avec commande de purge ([#137](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/137)).
- Synchronisation de l'adaptateur GitHub Projects et protection contre la dérive ([#138](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/138)).
- Parcours de cycle de vie réels, du navigateur à l'API et PostgreSQL, pour génération et mise à jour.

### Modifications

- La configuration du workflow est centralisée dans `.saasfoundry.json` ; l'ancien `.saasfoundry-workflow.json` est obsolète.
- `getAvailableModules` utilise désormais le catalogue enrichi ([#60](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/60)).
- Le harness peut être utilisé avec plusieurs agents déclarés et conserve la même source de vérité partagée.

### Corrections

- Message d'erreur généralisé lorsque le mode non interactif manque de valeurs ([#59](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/59)).
- `_cache_fresh` tient compte de `OSTYPE` afin d'utiliser le bon champ de `stat` sous GNU ([#135](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/135)).

## [1.0.0-beta]

Première version bêta du générateur :

- **Backend** : NestJS 11, Prisma 7 avec driver adapters, PostgreSQL 16, JWT, Passport et Zod 4.
- **Frontend** : React 19, React Router v7, Vite 7, Tailwind CSS 4, Radix UI, ShadCN UI, React Query, React Hook Form, Zod 4 et i18next.
- **Infrastructure** : builds Docker multi-étapes, Nginx et réseau `saasfoundry-network`.
- **Topologies** : monorepo et multirepo.
- **Modules optionnels** : email MailerSend, stockage S3, analytics Umami, PWA et SRS/harness selon la configuration.
