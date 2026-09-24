# Développement

Ce guide explique comment contribuer au CLI SaaSFoundryAI : préparer le dépôt, exécuter la matrice de tests et respecter les conventions vérifiées par Husky.

Si vous souhaitez seulement utiliser le CLI dans un projet généré, consultez le [démarrage rapide](/fr/getting-started/quick-start). Cette page concerne le **moteur de scaffolding** : templates,
installateurs et migrations.

## Prérequis

- **Node.js** — exécutez `nvm use` : le `.nvmrc` du dépôt fixe actuellement `22.15.0`. `package.json` accepte Node `>=22.0.0` et npm `>=10.0.0`.
- **Docker avec Compose** — nécessaire à la base de développement et aux cycles E2E réels dans `tests/docker/`.
- **Réseau Docker** — créez-le une fois avec `docker network create saasfoundry-network`.
- **GitHub CLI (`gh`)** — nécessaire à `workflow-cli.sh` et `github-projects-cli.sh`; authentifiez-vous avec `gh auth login`.

Les applications générées suivent leur propre `.nvmrc` et ciblent actuellement Node `24.19.0`. Ne supposez pas que la version du CLI et celle du produit généré sont identiques.

La résolution des voies de cycle de vie utilise le runtime TypeScript du dépôt et n'ajoute pas de dépendance séparée à `jq`.

## Structure du dépôt

Le fichier [`CLAUDE.md`](https://github.com/DiamondForgeFr/SaasFoundryAI/blob/develop/CLAUDE.md) expose les règles opérationnelles. Les principaux répertoires sont :

| Chemin                        | Rôle                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------ |
| `src/commands/`               | Points d'entrée Commander : `new`, `update`, `workflow`, `srs`, `status`, etc. |
| `src/builders/`               | Construction des topologies, de la base et des services                        |
| `src/installers/`             | Installateurs réutilisables pour email, storage, analytics, SRS et harness     |
| `src/migrations/`             | Registres des migrations du manifeste et des modules                           |
| `scaffolds/blueprints/`       | Templates de base `api/`, `web/`, `db/`, `s3/`                                 |
| `scaffolds/overlays/`         | Variantes monorepo/multirepo et overlays de modules                            |
| `scaffolds/skills-templates/` | Sources des compétences déposées dans les projets                              |
| `tests/docker/`               | Cycles réels navigateur → API → PostgreSQL pour génération et mise à jour      |
| `.claude/skills/`             | Dépôts locaux dogfoodés, protégés contre la dérive avec les templates          |
| `.agents/skills/`             | Surface partagée entre agents pendant la phase de compatibilité                |
| `.claude/docs/`               | Références internes sur les modules, les compétences et les migrations         |

Avant de modifier ces zones, lisez :

- `.claude/docs/architecture-modules.md` ;
- `.claude/docs/architecture-skills.md` ;
- `.claude/docs/migration-framework.md`.

La fixture immuable de la version précédente possède son runbook dans
[`tests/docker/fixtures/previous-release/1.0.0-beta/README.md`](https://github.com/DiamondForgeFr/SaasFoundryAI/blob/develop/tests/docker/fixtures/previous-release/1.0.0-beta/README.md).

## Installation locale

```bash
git clone https://github.com/DiamondForgeFr/SaasFoundryAI.git
cd SaasFoundryAI

nvm use
npm install
npm run build
npm run dev
```

Pour tester le checkout dans un vrai projet :

```bash
npm link
cd /tmp
sf new --project-name local-test --structure monorepo
```

`npm unlink -g saasfoundryai-cli` retire le lien global et restaure l'installation précédente.

## Build, tests, formatage et lint

| Commande                                              | Effet                                                                | Quand l'utiliser                                 |
| ----------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------ |
| `npm run build`                                       | Compile TypeScript dans `dist/`                                      | Avant publication ou exécution autonome          |
| `npm run dev`                                         | Compilation incrémentale `tsc -w`                                    | Pendant le développement                         |
| `npm run format`                                      | Prettier sur les sources et la documentation                         | Avant commit                                     |
| `npm run lint`                                        | ESLint avec `eslint.config.mjs`                                      | Avant commit                                     |
| `npm test`                                            | Projets Jest unit, integration, e2e et smoke                         | Pendant l'itération                              |
| `npm run test:unit`                                   | Tests unitaires                                                      | Feedback rapide                                  |
| `npm run test:integration`                            | Builders, scaffolds et installateurs                                 | Après modification de génération                 |
| `npm run test:e2e`                                    | Surface des commandes CLI                                            | Après modification du câblage CLI                |
| `npm run test:pre-commit`                             | format + lint + build + contrôle du package + Jest                   | Contrôle déclenché par le hook de commit         |
| `npm run test:pre-push`                               | Voie normale : monorepo full, multirepo full, update précédent smoke | Explicitement pendant `AI testing`               |
| `npm run test:full`                                   | pré-commit puis pré-push                                             | Avant de déclarer une livraison terminée         |
| `npm run test:docker:full`                            | Voie exhaustive génération + update, deux topologies                 | Release, planification ou validation approfondie |
| `npm run test:docker:list -- --lane normal`           | Liste scénarios, profondeur navigateur et budget                     | Inspection du contrat CI                         |
| `npm run test:docker:scenario -- <name> --depth full` | Exécute un seul cycle avec l'image partagée                          | Reproduction ciblée                              |

La durée dépend de la machine et du cache ; fiez-vous aux artefacts de timing plutôt qu'à une estimation figée dans la documentation.

## Commits conventionnels

Chaque commit suit :

```text
<type>(#<ticket>): <description>
```

- `type` : `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `ci`, `build` ou `revert` ;
- le numéro de ticket est obligatoire ;
- l'en-tête est limité à 100 caractères.

Exemples :

```text
feat(#317): calibrate SRS intent detector
fix(#292): normalize color rejection case
docs(#388): enforce migration framework on breaking changes
```

N'utilisez pas `#000` comme échappatoire. Même la maintenance du dépôt doit être rattachée à un ticket réel lorsque le workflow l'exige.

## Hooks Husky

| Hook         | Exécution                                                  |
| ------------ | ---------------------------------------------------------- |
| `commit-msg` | vérification du format par commitlint                      |
| `pre-commit` | `npm run test:pre-commit`                                  |
| `pre-push`   | validations RC/tag et WIP ; aucun cycle Docker automatique |

Si Prettier modifie des fichiers, le commit est interrompu. Ajoutez les fichiers formatés et créez un nouveau commit ; n'amendez pas le commit précédent.

Les branches/tags RC, les exécutions planifiées et les lancements manuels utilisent la voie exhaustive. Les pushes ordinaires sur `develop` et `master` ne répètent pas les builds Docker.
`npm run test:pre-push` est exécuté et documenté pendant `AI testing`.

Dans le workflow d'équipe, la PR de `Human testing` reste en brouillon pour la validation fonctionnelle. Après approbation et ajout des tests de non-régression requis,
`workflow-cli.sh ready-pr <ticket>` la rend prête et déclenche la CI complète. `draft-pr <ticket>` permet de revenir en validation fonctionnelle.

## Framework de migration — obligatoire

Tout changement cassant doit passer par le framework de migration. Les shims dans `sf update`, les mutations ponctuelles de types et les corrections manuelles du manifeste réintroduisent la dérive que
ce système évite.

### Forme du manifeste

Un renommage, une suppression ou une restructuration de `SaaSFoundryManifest` exige :

1. une migration numérotée dans `src/migrations/manifest/NNN-<name>.ts` ;
2. son enregistrement dans `src/migrations/manifest/index.ts` ;
3. la mise à jour du schéma JSON ;
4. une paire de fixtures golden dans `src/__tests__/unit/migrations/fixtures/NNN-<name>/`.

Ne modifiez jamais le manifeste directement dans une commande et n'incrémentez pas `manifestVersion` sans migration enregistrée.

### Ensemble de fichiers d'un module

Un renommage de fichier, une séparation de service ou une nouvelle variable obligatoire exige une hausse de `currentVersion` dans l'installateur et une `ModuleMigration`. Utilisez `writeMigratedFile`
pour que les fichiers personnalisés produisent un sidecar `.saasfoundry.new`.

Lisez [le playbook de migration](https://github.com/DiamondForgeFr/SaasFoundryAI/blob/develop/.claude/docs/migration-framework.md) avant toute modification de `src/types.ts`, du schéma, des templates
déposés ou de `src/migrations/`.

## Workflow du dépôt — ne jamais contourner les statuts

Ce dépôt utilise le preset d'équipe :

```text
Backlog → Ready → In progress → AI testing → Human testing → In review → Done
```

- Lisez le document du statut courant avant une transition.
- Utilisez `.claude/skills/sf-workflow/workflow-cli.sh` ; ne déplacez pas une carte manuellement.
- Les enfants sont des sous-issues GitHub natives, pas des cases Markdown.
- Un enfant normal possède sa branche et sa PR.
- Un enfant `nature:bundled-pr` fournit un commit atomique à la branche de livraison du parent et n'a pas de PR séparée.
- `Human testing` signifie validation fonctionnelle sur PR brouillon ; `In review` signifie revue de code sur PR prête avec CI complète.

Les projets générés peuvent choisir le preset Solo à cinq statuts ou un workflow personnalisé. Les agents doivent lire `workflow.statuses` dans le manifeste au lieu de généraliser le preset de ce
dépôt.

Référence : [`sf-workflow/SKILL.md`](https://github.com/DiamondForgeFr/SaasFoundryAI/blob/develop/.claude/skills/sf-workflow/SKILL.md).

## Ajouter un module ou une compétence

### Module

Lisez [l'architecture des modules](https://github.com/DiamondForgeFr/SaasFoundryAI/blob/develop/.claude/docs/architecture-modules.md). Traitez les marqueurs du blueprint, les overlays,
`currentVersion`, les migrations, le manifeste et les signaux de cycle Docker.

### Compétence

Lisez [l'architecture des compétences](https://github.com/DiamondForgeFr/SaasFoundryAI/blob/develop/.claude/docs/architecture-skills.md). Modifiez la source sous `scaffolds/skills-templates/`,
synchronisez les dépôts locaux attendus et vérifiez le drift guard.

## Publier une release

Les releases partent de `master`. Les hooks RC valident l'état mais ne créent ni commit ni tag :

1. Depuis `develop`, créez `rc-X.Y.Z`.
2. Avant le premier push, exécutez `npm version X.Y.Z --no-git-tag-version`, mettez à jour le changelog et committez avec le ticket de release.
3. Poussez la branche RC et ouvrez sa PR vers `master`. La version et le nom de branche doivent correspondre, et la matrice Docker complète doit réussir.
4. Fusionnez avec un merge commit, synchronisez `master`, vérifiez le commit et le contenu du package, puis créez le tag annoté `vX.Y.Z`.
5. Publiez `saasfoundryai-cli@X.Y.Z` depuis ce commit vérifié et contrôlez le dist-tag `latest`.
6. Resynchronisez le commit de release vers `develop` et vérifiez une installation globale propre.

La v1 possède un historique `master` divergent. Sa branche RC doit d'abord enregistrer cet historique avec `git merge -s ours --no-ff origin/master`, selon le ticket de release #488. N'utilisez pas
`-X ours`, qui peut conserver des fichiers obsolètes non conflictuels.

Les objectifs d'acceptation sont dans [`.claude/docs/release-objectives.md`](https://github.com/DiamondForgeFr/SaasFoundryAI/blob/develop/.claude/docs/release-objectives.md).

## Signaler un défaut ou proposer une fonctionnalité

- **Défaut** : fournissez une reproduction minimale ; le triage ajoutera la complexité appropriée.
- **Fonctionnalité** : commencez par le résultat visible pour l'utilisateur, puis décrivez l'implémentation envisagée.
- **Sécurité** : ne publiez pas d'issue. Utilisez l'adresse du mainteneur indiquée dans `package.json`.

## Synchroniser « Ready for review » avec GitHub Projects

Le bouton **Ready for review** déclenche `.github/workflows/pr-review-sync.yml`. Le workflow inspecte la PR et son ticket lié, puis utilise le CLI protégé pour passer le ticket en `In review`.

Configurez le secret Actions `SF_PROJECTS_TOKEN` avec l'accès au dépôt et l'écriture sur le Project de l'organisation. Le token Actions par défaut n'accède pas à Projects.

Le listener doit être fusionné sur la branche par défaut et n'exécute jamais le code de la branche de PR. Il prend en charge les PR du même dépôt, exige que le lien de fermeture natif corresponde au
numéro présent dans la branche et conserve tous les garde-fous. Après une erreur de secret ou de liaison, corrigez puis relancez. Utilisez le CLI manuellement pour les forks.

## Voir aussi

- [`CLAUDE.md`](https://github.com/DiamondForgeFr/SaasFoundryAI/blob/develop/CLAUDE.md)
- [Compétences principales](/fr/skills/core-skills)
- [Système de modules](/fr/guide/module-system)
- [Architecture des modules](https://github.com/DiamondForgeFr/SaasFoundryAI/blob/develop/.claude/docs/architecture-modules.md)
- [Architecture des compétences](https://github.com/DiamondForgeFr/SaasFoundryAI/blob/develop/.claude/docs/architecture-skills.md)
- [Framework de migration](https://github.com/DiamondForgeFr/SaasFoundryAI/blob/develop/.claude/docs/migration-framework.md)
