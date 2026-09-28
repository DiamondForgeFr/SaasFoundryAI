# Livrer votre premier ticket

Ce parcours pratique présente le workflow d'équipe SaaSFoundryAI, d'une idée dans le backlog jusqu'au merge vérifié. Vous allez faire avancer un vrai ticket dans le preset Team à sept statuts.

**Durée** : environ 20 minutes. **Prérequis** : un projet généré avec `sf new` et relié à un tableau GitHub Project. GitHub Projects fournit le contrat V1 complet. Jira et Linear sont des adaptateurs
expérimentaux, tandis que Notion est le backend SRS V1 complet et non un tracker de workflow complet.

## Fonctionnalité d'exemple

Nous allons livrer un endpoint minimal : **`GET /api/version`**, qui renvoie `{ version: "1.0.0" }` depuis `package.json`.

- Complexité : 🟢 **low** — aucun changement de schéma, aucune dépendance ni surface de sécurité. Un seul endpoint de moins de vingt lignes.
- Branche cible : celle déclarée par `workflow.prTargetBranch`.

La fonctionnalité est volontairement triviale. L'objectif n'est pas d'impressionner, mais de parcourir **chaque statut** afin de pouvoir faire confiance au processus sur une fonctionnalité plus
difficile.

## Les sept statuts en un coup d'œil

```text
Backlog → Ready → In progress → AI testing → Human testing → In review → Done
```

Chaque transition possède une action obligatoire. Sauter un statut est le chemin le plus court vers un défaut en production. La skill `sf-workflow`, installée dans chaque projet généré, protège ces
transitions afin que l'humain et l'agent suivent les mêmes règles.

::: info Quel preset utilisez-vous ?

- **Team**, utilisé dans ce guide, sépare **Human testing**, le test de la fonctionnalité et sa validation fonctionnelle, de **In review**, la revue de code.
- **Solo** suit `Backlog → In progress → AI testing → In review → Done`. Les mêmes preuves d'implémentation et de test restent nécessaires, et la validation fonctionnelle manuelle se déroule pendant
  la revue de la PR puisqu'il n'existe pas de colonne Human testing séparée.
- **Custom** enregistre et synchronise les statuts du board, mais la v1 ne génère des documents et garde-fous complets que pour Team et Solo. Étendez le skill de workflow installé avant de suivre un
  parcours personnalisé.

:::

## Étape 1 — Backlog : créer le ticket

Dans le tableau GitHub Project, créez un ticket :

- **Titre** : `Add /api/version endpoint`
- **Description** : `Expose the current package.json version at GET /api/version. Returns { version: string }. No auth required, public endpoint.`
- **Colonne** : `Backlog`

::: tip Laisser l'agent de code s'en charger

Si l'agent courant découvre la skill `sf-workflow`, demandez simplement :

> « Create a backlog ticket: add a /api/version endpoint that returns the package.json version. Low complexity. »

L'agent crée le ticket, applique la complexité et le place sur le tableau en appelant le même CLI que vous utiliseriez manuellement.

:::

### Étiqueter la complexité

La complexité est portée par une **étiquette**, pas par le statut. Configuration unique par dépôt :

```bash
gh label create "complexity: low"    --color 7CFC00 --description "🟢 Low complexity"
```

Puis appliquez-la au ticket :

```bash
CLI=.claude/skills/sf-tool-github-projects/github-projects-cli.sh
$CLI set-complexity 42 low   # remplacez 42 par le numéro du ticket
```

La complexité détermine le niveau de contrôle appliqué ensuite. Un ticket `low` reste léger, sans validation de plan et avec une analyse minimale. Un ticket `complex` déclenche une revue
contradictoire complète.

## Étape 2 — Backlog → Ready

Avant d'avancer, vérifiez que la spécification est claire. Pour un ticket `low`, cela signifie généralement :

- des critères d'acceptation écrits, même en une ligne ;
- aucune question ouverte sur le contrat HTTP ;
- aucune hypothèse risquée sur l'authentification, les données ou un service externe.

Lorsque la spécification est prête :

```bash
$CLI update-status 42 "Ready"
```

Le ticket se trouve maintenant dans la file de l'équipe.

## Étape 3 — Ready → In progress

Créez une branche depuis la branche de travail :

```bash
git checkout develop
git pull --rebase
git checkout -b feature/42-version-endpoint
```

Puis mettez à jour le tableau :

```bash
$CLI update-status 42 "In progress"
```

### Décomposer si nécessaire

La décomposition est souvent inutile pour un ticket `low`. Pour un ticket `medium` ou `complex`, le workflow exige de **vrais sous-tickets**, pas des éléments de checklist :

```bash
$CLI create-subtask 42 "Backend endpoint"
$CLI create-subtask 42 "Integration test"
```

Les sous-tickets sont reliés au moyen de la mutation GraphQL `addSubIssue`. Le workflow lit cette hiérarchie native via l'API GitHub : un parent ne peut atteindre `Done` tant que chaque enfant n'a pas
le statut Projects `Done`. Un Epic passe aussi à `In progress` avec son premier enfant actif, puis à `Done` lorsque le dernier est terminé.

## Étape 4 — Développer la fonctionnalité

Côté `apps/api`, ajoutez l'endpoint selon les conventions du scaffold :

```ts
// apps/api/src/modules/version/version.controller.ts
import { Controller, Get } from '@nestjs/common'
import { VersionService } from './version.service'

@Controller('version')
export class VersionController {
  constructor(private readonly versionService: VersionService) {}

  @Get()
  getVersion() {
    return { version: this.versionService.getVersion() }
  }
}
```

```ts
// apps/api/src/modules/version/version.service.ts
import { Injectable } from '@nestjs/common'
import { readFileSync } from 'fs'
import { join } from 'path'

@Injectable()
export class VersionService {
  getVersion(): string {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
    return pkg.version ?? '0.0.0'
  }
}
```

Connectez le module, puis écrivez le test :

```ts
// apps/api/src/modules/version/tests/unit/version.service.spec.ts
import { VersionService } from '../../version.service'

describe('VersionService', () => {
  it('returns the package.json version', () => {
    const service = new VersionService()
    expect(service.getVersion()).toMatch(/^\d+\.\d+\.\d+/)
  })
})
```

## Étape 5 — Commiter et pousser

Utilisez le format de commit imposé par le projet :

```bash
git add apps/api/src/modules/version/
git commit -m "feat(#42): add /api/version endpoint"
git push -u origin feature/42-version-endpoint
```

Le hook de pre-commit classe les chemins indexés avec `npm run test:staged` et n'exécute que les voies de validation nécessaires, sans modifier les fichiers. Pour cet endpoint API, il sélectionne les
contrôles backend et le signal de cycle de vie concerné ; un commit limité à la documentation ne lance pas la matrice produit. Les preuves de cycle de vie lourdes restent exécutées explicitement
pendant AI testing avant Human testing.

## Étape 6 — In progress → AI testing

Lorsque le commit est présent sur le remote, confiez le ticket à la validation automatisée :

```bash
$CLI update-status 42 "AI testing"
```

AI testing exécute le plan de test préparé par l'agent. Pour un endpoint de complexité `low`, il ressemble à ceci :

```bash
npm run build
npm run lint
npm run type-check
npm run test:unit
curl http://localhost:3500/api/version     # smoke test against the dev server
```

L'agent publie un plan avant l'exécution et un rapport après. Il exécute aussi la validation lourde configurée, par exemple `npm run test:pre-push`. Si tout passe, il ouvre ou réutilise une PR draft
afin de figer le diff et les preuves pendant le test fonctionnel :

```bash
$CLI create-pr 42 --draft
```

## Étape 7 — AI testing → Human testing

```bash
$CLI update-status 42 "Human testing"
```

**Human testing est le test de la fonctionnalité et sa validation fonctionnelle. Ce n'est pas la revue de code.** Démarrez les serveurs et vérifiez le comportement dans un navigateur ou avec curl. La
revue de code intervient au statut suivant.

```bash
npm run dev
# dans un autre terminal
curl http://localhost:3500/api/version
# → { "version": "1.0.0" }
```

Contrôlez :

- [ ] que l'endpoint renvoie la bonne structure ;
- [ ] qu'il est accessible sans authentification comme prévu ;
- [ ] qu'aucune route voisine n'a régressé.

### En cas d'anomalie

Gardez la PR en draft. Documentez l'anomalie sur le ticket, corrigez-la sur la branche, committez, poussez, puis **reprenez depuis AI testing**. Réutilisez la même PR draft après publication des
nouvelles preuves.

## Étape 8 — Human testing → In review

La fonctionnalité a été validée. Rendez la PR existante prête et entrez en **revue de code** :

```bash
$CLI ready-pr 42
$CLI update-status 42 "In review"
```

La PR prête renvoie vers le ticket, contient les preuves de test et déclenche la CI complète. Les relecteurs examinent maintenant la qualité de l'implémentation. La CI doit être verte et les
approbations requises obtenues avant le merge.

## Étape 9 — In review → Done

Lorsque la PR est approuvée et la CI verte, effectuez le merge dans l'interface GitHub. Finalisez ensuite :

```bash
$CLI update-status 42 "Done"
git checkout develop
git pull --rebase
git branch -d feature/42-version-endpoint
```

Le ticket est fermé, la branche nettoyée et la fonctionnalité livrée.

## Ce que vous venez de pratiquer

Même pour un endpoint trivial, chaque garde-fou a joué son rôle :

| Statut        | Action                                  | Garde-fou                                        |
| ------------- | --------------------------------------- | ------------------------------------------------ |
| Backlog       | Création et complexité du ticket        | La spécification vit dans le ticket, pas le chat |
| Ready         | Confirmation des critères               | Aucun ticket ambigu n'entre en implémentation    |
| In progress   | Branche et éventuelle décomposition     | Aucun travail hors du système de statuts         |
| AI testing    | Plan et exécution des tests automatisés | Les tests précèdent la validation humaine        |
| Human testing | Test fonctionnel dans un runtime réel   | Les angles morts de l'automatisation sont vus    |
| In review     | Revue de code, CI et approbations       | Le code est examiné avant livraison              |
| Done          | Nettoyage et confirmation               | Aucun travail à moitié fermé ne reste au tableau |

Le ticket suivant, même dix fois plus grand, suit **le même parcours**. L'étiquette de complexité `medium` ou `complex` augmente simplement la rigueur à chaque étape. L'agent lit le même
`.saasfoundry.json` et les mêmes fichiers `sf-workflow` que vous ; il applique donc la même discipline.

## Étapes suivantes

- Lisez le [système de workflow](/fr/workflow/introduction) pour comprendre la philosophie des statuts.
- Consultez le [système de complexité](/fr/workflow/complexity-system) pour le contrat `bug`, `low`, `medium` et `complex`.
- Lisez les [règles des agents](/fr/workflow/ai-rules) et leurs garde-fous.
- Parcourez [Premier projet](/fr/getting-started/first-project) pour approfondir le code généré.
