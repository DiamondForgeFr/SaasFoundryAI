# Monorepo ou multirepo

SaaSFoundryAI génère la même API NestJS et la même application web React selon deux topologies de dépôts. Les capacités produit restent équivalentes ; la propriété, le partage de code, la CI et les
frontières de livraison changent.

**Choisissez le monorepo par défaut.** Choisissez le multirepo lorsque l'API et le web ont réellement besoin de propriétaires, de permissions ou de calendriers de livraison distincts.

## Tableau de décision

| Sujet                    | Monorepo                                                                   | Multirepo                                                                         |
| ------------------------ | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Propriété des dépôts     | Un dépôt pour l'API, le web, les packages et le harness.                   | Checkouts API et web indépendants sous un coordinateur racine.                    |
| Organisation de l'équipe | Une équipe produit ou full-stack.                                          | Équipes frontend/backend séparées ou frontières d'accès.                          |
| Cadence de livraison     | Une PR peut modifier l'API et le web de façon atomique.                    | Chaque application possède sa version, sa revue et son déploiement.               |
| CI                       | Un graphe de tâches Turbo avec cache et ordre des workspaces.              | Chaque application possède ses scripts, lockfile, hooks et CI.                    |
| Contrats partagés        | Packages canoniques et miroirs d'applications lorsque nécessaire.          | Copies identiques des types et validations dans chaque app, sans package partagé. |
| Client API               | Snapshot OpenAPI → client React Query généré par Orval.                    | Hooks web écrits à la main contre le contrat API.                                 |
| Primitives UI            | Package workspace `ui-primitives`.                                         | Composants vendored dans l'application web.                                       |
| Coût opérationnel        | Changements full-stack simples, périmètre de checkout et de CI plus large. | Autonomie forte, coordination accrue pour aligner les contrats.                   |

La topologie n'est pas un niveau de qualité. Le multirepo n'est pas « plus scalable » et le monorepo n'est pas « réservé aux petits projets ». Choisissez la frontière qui correspond à la propriété et
au mode de livraison réels des deux applications.

## Monorepo — un workspace produit coordonné

```text
mon-saas/
├── apps/
│   ├── api/                         NestJS
│   └── web/                         React
├── packages/
│   ├── shared-types/
│   ├── shared-validation/
│   ├── shared-config/
│   ├── api-client/
│   └── ui-primitives/
├── .saasfoundry.json
├── package.json                     workspaces npm
└── turbo.json                       graphe de tâches
```

Le `package.json` racine déclare `apps/*` et `packages/*` comme workspaces npm. Turbo planifie les tâches `build`, `lint`, `type-check`, unitaires, end-to-end et de génération. Une tâche peut dépendre
des builds de ses dépendances workspace grâce à `dependsOn: ["^build"]`.

Deux garanties pratiques en découlent :

- un seul lockfile et une commande racine décrivent tout le produit ;
- une évolution du contrat API, du client généré et de la page qui le consomme peut arriver dans une PR atomique.

### Les cinq packages du workspace

| Package             | Rôle                                                                           | Règle de modification                                                                   |
| ------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `shared-types`      | Interfaces du domaine partagées par l'API et le web.                           | Source canonique sous `packages/shared-types/src/` ; garder les miroirs alignés.        |
| `shared-validation` | Fabriques de schémas Zod et types de payload inférés.                          | Source canonique sous `packages/shared-validation/src/` ; garder les miroirs alignés.   |
| `shared-config`     | Constantes runtime consommées par les deux applications.                       | Importer directement le package workspace ; les modules peuvent y déposer des fichiers. |
| `api-client`        | Modèles et fonctions React Query générés par Orval depuis le snapshot OpenAPI. | Régénérer ; ne jamais modifier les fichiers générés à la main.                          |
| `ui-primitives`     | Primitives shadcn, utilitaires et tokens de thème partagés.                    | Placer ici les primitives réutilisables ; garder les compositions métier dans le web.   |

Les noms de packages générés utilisent le scope du projet, par exemple `@acme-portal/shared-validation`. Le builder remplace le placeholder du projet avant de livrer le scaffold.

### Pourquoi les types et validations ont aussi des miroirs

Même en monorepo, les applications générées conservent des miroirs sous `apps/api/src/shared-*` et `apps/web/src/shared-*`. Les alias stables `@shared-types/*` et `@shared-validation/*` fonctionnent
ainsi dans les deux topologies, et chaque application peut compiler indépendamment.

La source de modification canonique reste `packages/<nom>/src/`. Des tests d'intégration imposent l'identité octet par octet entre cette source et les deux miroirs. Pour ajouter un contrat de domaine
:

1. modifiez le fichier du package canonique ;
2. recopiez exactement la modification dans les miroirs API et web ;
3. exportez le nouveau fichier depuis les trois `index.ts` ;
4. lancez les tests afin que le garde de dérive prouve la parité.

Il s'agit d'une duplication contrôlée, pas de trois définitions indépendantes.

### Client API généré

L'API publie `apps/api/docs/openapi.json` au démarrage. Orval lit ce snapshot et régénère `packages/api-client/src/generated/api/` :

```bash
npm run dev:api     # actualiser le snapshot OpenAPI
npm run codegen     # régénérer modèles et fonctions React Query
```

Commitez le snapshot OpenAPI et le client généré ensemble. Le script de contrôle régénère le client depuis le snapshot et échoue lorsque le résultat diffère du client commité.

La génération doit être relancée après l'ajout d'une route ou méthode, la modification d'un champ DTO, d'un schéma de requête/réponse ou d'un tag API. Un refactoring interne de service sans changement
de surface HTTP ne l'exige pas.

## Multirepo — deux applications possédées indépendamment

```text
mon-saas/                              coordinateur racine
├── .saasfoundry.json                 manifeste canonique du scaffold
└── apps/
    ├── mon-saas-api/                 checkout Git indépendant
    │   ├── .saasfoundry.json         projection API
    │   ├── package.json
    │   └── src/
    └── mon-saas-web/                 checkout Git indépendant
        ├── .saasfoundry.json         projection web
        ├── package.json
        └── src/
```

Chaque manifeste enfant déclare `structure: "cli"` et une `projection` vers le projet racine et le type d'application. `sf status` et les commandes de cycle de vie des agents fonctionnent ainsi dans
chaque checkout, tandis que les transitions de profil portant sur toute la stack restent sous la responsabilité du coordinateur racine.

La topologie multirepo générée ne possède pas de workspace racine `packages/`. Chaque application doit compiler et se tester sans l'autre checkout.

### Correspondance des éléments partagés

| Élément monorepo              | Équivalent multirepo                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| `packages/shared-types/`      | Fichiers correspondants sous `api/src/shared-types/` et `web/src/shared-types/`.            |
| `packages/shared-validation/` | Fichiers correspondants sous `api/src/shared-validation/` et `web/src/shared-validation/`.  |
| `packages/shared-config/`     | Constantes placées chez leur consommateur ; aucun package transverse.                       |
| `packages/api-client/`        | Hooks web implémentés sous `web/src/hooks/api/<fonctionnalité>/`.                           |
| `packages/ui-primitives/`     | Composants vendored sous `web/src/components/ui/shadcn/` ; tokens dans `web/src/index.css`. |

Les copies des types et validations sont volontairement identiques. Les tests SaaSFoundryAI comparent les blueprints générés, mais une évolution quotidienne en multirepo exige toujours des changements
coordonnés et des versions compatibles dans les deux dépôts.

## Exemple concret — créer une invitation

Les deux topologies partent de la même fabrique de schéma Zod :

```ts
import { z } from 'zod'

export const buildCreateInvitationPayloadSchema = () =>
  z
    .object({
      email: z
        .string()
        .min(1)
        .max(100)
        .email()
        .transform((value) => value.toLowerCase()),
      roleIds: z.array(z.number()).optional(),
      accountIds: z.array(z.string()).optional(),
      entityIds: z.array(z.string()).optional()
    })
    .strict()

export type CreateInvitationPayload = z.infer<ReturnType<typeof buildCreateInvitationPayloadSchema>>
```

L'API la transforme en DTO NestJS :

```ts
import { createZodDto } from 'nestjs-zod'
import { buildCreateInvitationPayloadSchema } from '@shared-validation/invitation'

export class CreateInvitationDto extends createZodDto(buildCreateInvitationPayloadSchema()) {}
```

La mutation web analyse le formulaire avec le même schéma avant l'envoi. Normalisation de l'email, rejet des champs inconnus, scopes optionnels et type de payload inféré restent donc identiques des
deux côtés.

### Fichiers en monorepo

```text
packages/shared-validation/src/invitation.ts       canonique
apps/api/src/shared-validation/invitation.ts       miroir
apps/web/src/shared-validation/invitation.ts       miroir
```

L'API et le web utilisent l'alias stable ; les tests du dépôt CLI prouvent l'équivalence des trois fichiers. Le snapshot OpenAPI alimente ensuite le client généré consommé par le web.

### Fichiers en multirepo

```text
apps/mon-saas-api/src/shared-validation/invitation.ts
apps/mon-saas-web/src/shared-validation/invitation.ts
```

Il n'existe ni troisième fichier canonique ni package Orval. Les équipes mettent à jour les deux copies dans une évolution coordonnée et maintiennent manuellement le hook de requête web. Le bénéfice
est le déploiement indépendant ; le coût est la synchronisation entre dépôts.

## Skills et instructions d'agents

Le monorepo installe les skills du harness et les points d'entrée des agents à la racine. Le multirepo les installe dans chaque checkout afin qu'un agent arrivant uniquement dans l'API ou le web
reçoive tout de même les bonnes instructions.

Les skills outils optionnels suivent la même règle de propriété : une copie racine en monorepo, une copie par application en multirepo. Sélectionner un profil d'agent enregistre ses surfaces
d'instructions ; cela n'installe ni n'authentifie le runtime de cet agent.

## Choisir pendant `sf new`

L'installation interactive demande la topologie. Une installation scriptée la rend explicite :

```bash
sf new --non-interactive \
  --profile full \
  --project-name mon-saas \
  --structure monorepo \
  --setup-repo local \
  --db-setup docker \
  --db-type postgresql \
  --email-service none \
  --s3-setup manual \
  --no-analytics
```

Pour un multirepo, remplacez `--structure monorepo` par `--structure multirepo`. Avec des remotes existants, le monorepo accepte une URL ; le multirepo accepte des URL backend et frontend séparées.

Consultez [`sf new`](/cli/sf-new) pour toutes les options et [Installation par CLI ou assistant](/fr/getting-started/setup-paths) pour les deux parcours d'onboarding.

## La topologie est conservée après la génération

Un projet géré uniquement par le harness n'a pas encore de topologie technique. `sf update --target-profile full` demande monorepo ou multirepo au moment d'ajouter la stack ; prévisualisez d'abord le
candidat :

```bash
sf update --target-profile full --dry-run --json
```

Dès qu'une stack technique existe, les mises à jour conservent sa structure. `stack → full` ajoute le harness géré et `full → full` ne fait rien. `sf update` ne convertit pas un monorepo en multirepo
ni l'inverse.

Changer de topologie constitue une migration de dépôts volontaire : il faut séparer ou réunir l'historique Git, les propriétaires, la CI, les secrets, les packages, le déploiement et la
synchronisation des contrats. Planifiez-la et relisez-la comme une évolution d'architecture, pas comme un simple flag du générateur.

## Recommandation

Commencez en monorepo, sauf si l'un de ces points est déjà vrai :

- l'API et le web appartiennent à des équipes différentes ;
- ils sont livrés selon des calendriers indépendants ;
- les accès aux dépôts doivent différer ;
- l'une des applications doit compiler sans accès à l'autre checkout.

Si aucun ne s'applique, le monorepo fournit des changements full-stack atomiques, un client généré, des primitives UI partagées et un seul graphe de validation avec moins de coordination.
