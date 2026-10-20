# sf srs

Pilotez l'espace SRS : l'arborescence de spécification à partir de laquelle l'agent rédige et génère des tickets.

Il s'agit du **chemin sans IA** : chaque opération ci-dessous peut aussi être demandée à l'agent dans la conversation. Celui-ci appelle alors les mêmes commandes par l'intermédiaire de la skill
`sf-srs`. Les commandes rendent ces opérations scriptables, testables et inspectables sans faire intervenir de modèle.

## Utilisation

```bash
sf srs <action> [args...]
```

Le [module SRS](/fr/modules/srs) doit être installé et un backend doit être configuré dans `.saasfoundry.json`, sous `tools.srs`.

## Actions

| Action         | Fonction                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------ |
| `help`         | Afficher l'aide                                                                            |
| `validate`     | Tester le backend configuré, ou vérifier une spécification hors ligne avec `--spec`        |
| `browse`       | Lister en JSON les enfants directs d'une page parente                                      |
| `draft`        | Produire un brouillon depuis des pages du backend ou une analyse du code                   |
| `write`        | Appliquer un fichier de spécification `DraftCandidate[]` via l'adaptateur                  |
| `versions`     | Lister les versions déclarées dans le SRS, source des propositions de périmètre de release |
| `next-ids`     | Prochain numéro de version et prochains identifiants libres d’une fonctionnalité           |
| `spawn`        | Transformer une page Epic en tickets                                                       |
| `normalize`    | Énumérer les pages FR d'un Epic et créer les sous-tickets Story                            |
| `apply-update` | Ajouter une exigence, ou modifier une FR existante sur place, à partir d'un correctif      |
| `eval`         | Mesurer l'actualité du SRS par rapport au code                                             |

### Détails

```bash
sf srs validate [manifest]
sf srs validate --spec <path>
sf srs browse --parent <id> [--manifest <path>]

sf srs draft --from notion-pages --ids <id1,id2,...> [--manifest <path>]
sf srs draft --from codebase [--path <dir>] [--manifest <path>]

sf srs write --spec <path> [--manifest <path>] [--no-clear-pending]
sf srs versions [--root-page <id>] [--manifest <path>]
sf srs next-ids --feature <page-url-or-id> [--json] [--manifest <path>]

sf srs spawn --epic <page-url-or-id> [--ticket <n>] [--version <title-url-or-id>]
             [--milestone <name>] [--complexity <level>] [--dry-run] [--manifest <path>] [--bypass-reason <text>]

sf srs normalize [--feature <url-or-id>] [--version-name <name>] [--apply]
                 [--manifest <path>] [--root-page <id>]

sf srs apply-update [--patch <path>] [--dry-run] [--manifest <path>]
sf srs eval [--path <dir>] [--root-page <id>] [--threshold <pct>] [--json] [--manifest <path>]
```

`write` relit la fonctionnalité à laquelle il ajoute une version, juste avant la première page, et refuse le lot (code 2, rien n’est écrit) si cette fonctionnalité porte déjà le titre ou le numéro de
version, ou l’un des identifiants UR/FR/DS/TC/NFR que le lot déclare : deux sessions qui étendaient la même fonctionnalité écrivaient le même `v3` et les mêmes identifiants. `next-ids` donne les
numéros à utiliser, lus dans le SRS lui-même plutôt que dans une lecture antérieure.

`apply-update` ajoute une UR, une FR, un DS, un TC ou une NFR (`add-ur`, `add-fr`, `add-ds`, `add-tc`, `add-nfr`) là où `write` l’aurait mis : dans son tableau sur la page de la fonctionnalité, avec
la version de la page visée, et pour une FR aussi dans le tableau des FR et la liste des changements de sa version. Il n’ajoute sous un titre « Added … » que si la page n’appartient pas au SRS ou si
le tableau manque, et le signale.

### Modifier une FR existante

`apply-update` modifie aussi, sur place, une FR qui existe déjà, avec un correctif `update-fr`. Le correctif désigne la FR par son identifiant et les champs qui changent :

```json
{
  "kind": "update-fr",
  "frId": "FR-AEX-014",
  "changes": {
    "description": "Routes by the cost of delivering a ticket, duration included.",
    "acceptanceCriteria": { "add": ["Durations break ties between tiers"], "remove": ["Exact text of a criterion to drop"] }
  },
  "change": "Amends FR-AEX-014 — cost per delivered ticket"
}
```

`changes` peut contenir `title`, `description`, `priority` (`P1`, `P2` ou `P3`), `complexity`, `endpoint`, `requestBody`, `securityRationale`, `acceptanceCriteria` et `validationRules`. Une liste
prend le tableau entier, qui la remplace en gardant son ordre, ou `{ "add": […], "remove": […] }`, qui la modifie : `remove` désigne le texte exact d’une entrée, une entrée déjà présente n’est pas
ajoutée une seconde fois, et une entrée absente de la liste produit seulement un avertissement.

La FR change là où elle est listée, et rien n’est ajouté comme élément séparé :

- la page de la FR : son tableau Summary et son tableau Field/Value, et pour un nouveau titre son titre de section et le titre de la page ;
- le tableau des FR de la version qui contient la FR, et celui de sa fonctionnalité (ils affichent le titre et la priorité) ;
- une ligne dans la liste « What changed in this version » de la version qui contient la FR : le `change` du correctif, ou `Amends <id> — <titre> (<champs>)`. `versionPageId` l’inscrit à la place sur
  une autre version de la même fonctionnalité, pour une FR d’une version antérieure modifiée pendant des travaux ultérieurs.

`--dry-run` affiche l’ancienne et la nouvelle valeur de chaque cellule, la ligne de changement et les avertissements, et n’écrit rien. Appliquer le correctif pour de bon affiche le même document avec
`"dryRun": false` :

```json
{
  "kind": "update-fr",
  "frId": "FR-AEX-014",
  "dryRun": true,
  "changes": [{ "page": "fr", "where": "FR page › Description", "before": "…", "after": "Routes by the cost of delivering a ticket, duration included." }],
  "changeLine": { "status": "would-add", "text": "Amends FR-AEX-014 — cost per delivered ticket", "versionTitle": "v1 — Routing" },
  "before": { "description": "…" },
  "followUps": ["Story #1017 (open) was spawned from FR-AEX-014 and keeps the old text: edit its body by hand — …"]
}
```

Ce qu’il refuse, avec le code `2` et sans rien écrire : un identifiant de FR qu’aucune page ne porte ou que plusieurs pages portent (`pageId` désigne celle à modifier), un `pageId` ou un
`versionPageId` qui ne convient pas, une page de FR qui ne peut pas recevoir le changement (page écrite avant l’existence de la ligne Complexity, ou modifiée à la main), un correctif vide, un champ
inconnu, une valeur hors de `P1`–`P3` ou des niveaux de complexité, et `id`, `group` ainsi que les références `urRefs`, `dsRefs` et `tcRefs` — changer une référence suppose aussi de changer les
tableaux des UR, DS et TC qui la listent, ce qui est un suivi ([#1056](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/1056)). Un backend dont l’adaptateur ne sait pas modifier une page
existante sort avec le code `5` et n’écrit rien ; Notion le sait. `--dry-run` appartient à `update-fr` : un correctif `add-*` avec `--dry-run` sort avec le code `2` au lieu d’écrire.

On peut le rejouer sans risque. Une cellule déjà à sa valeur est laissée telle quelle et la ligne de changement n’est pas écrite deux fois : appliquer deux fois le même correctif n’écrit rien la
seconde fois. La page de la FR est écrite en premier, puis le tableau de la version, celui de la fonctionnalité et la ligne de changement, de sorte que l’historique ne déclare jamais un changement que
les tableaux n’ont pas. Une écriture qui s’arrête en cours de route sort avec le code `6` et affiche `applied`, `pending` et `before` ; appliquer de nouveau le même correctif la termine, et un
correctif dont les `changes` sont ce `before` revient en arrière.

La Story déjà générée depuis la FR garde le texte qu’avait la FR : elle n’est pas réécrite ([#1057](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/1057)). Le `followUps` du résultat la nomme,
pour que vous mettiez son corps à jour à la main.

### Générer des tickets

L'option `--milestone` de `spawn` **déclare la release dans laquelle ces tickets seront livrés** : le milestone est créé ou réutilisé, la page de version lui est associée et tous les tickets générés
le rejoignent.

L'option `--complexity <niveau>` de `spawn` étiquette chaque Story créée dont la page FR n'indique pas de complexité (`bug`, `low`, `medium` ou `complex`) ; la complexité de la page FR l'emporte. Le
résumé liste les Stories restées sans complexité, que le workflow refuse de sortir du Backlog.

`--version` accepte le titre de la version, l’identifiant de sa page avec ou sans tirets, ou son URL, en `www.notion.so` comme en `app.notion.com`.

Avant de créer quoi que ce soit, `spawn` cherche dans le dépôt les tickets qui portent déjà chaque FR, trois FR par recherche GitHub. GitHub autorise 30 recherches par minute ; quand une recherche
atteint cette limite, `spawn` attend 60 secondes puis réessaie, jusqu’à trois fois. La variable `SF_SEARCH_RATE_LIMIT_WAIT` (en secondes) change cette attente.

`spawn` réutilise le ticket qui porte déjà la page canonique d’une FR, avec ou sans `--reconciliation-plan`. Un ticket fermé est réutilisé tel quel et jamais rouvert, un ticket fermé comme « not
planned » (la façon de fermer un doublon) est ignoré, et une FR sans ticket est créée. Deux candidats pour une même FR, ou un candidat qui appartient à un autre parent, arrêtent l’exécution avec le
code `10` avant que quoi que ce soit ne soit écrit. Sans `--ticket`, l’Epic de version ouvert qu’une exécution précédente a créé est adopté au lieu d’être recréé.

`--dry-run` affiche une ligne par FR : `reuse #N`, `reuse #N (closed)`, `create`, ou `blocked — <raison>` (une FR bloquée fait aussi sortir le dry run avec le code `10`). Un doublon déjà créé se
détache de son Epic avec `workflow-cli.sh unlink-subtask <epic> <doublon>` ; fermez-le comme « not planned » et chaque `spawn` suivant l’ignore.

## Options communes

| Option              | Description                  | Valeur par défaut   |
| ------------------- | ---------------------------- | ------------------- |
| `--manifest <path>` | Fichier manifest à consulter | `.saasfoundry.json` |

## Codes de sortie

Toutes les actions partagent le même contrat. Un script peut donc réagir à la cause plutôt qu'au texte d'un message :

| Code | Signification                                                                                                   |
| ---- | --------------------------------------------------------------------------------------------------------------- |
| `0`  | succès                                                                                                          |
| `2`  | entrée incorrecte                                                                                               |
| `3`  | backend absent                                                                                                  |
| `4`  | backend inconnu                                                                                                 |
| `5`  | erreur d'exécution, ou backend qui ne sait pas modifier une page                                                |
| `6`  | écriture partielle ; la sortie contient un `rollbackHint`, ou pour `update-fr` `applied`, `pending` et `before` |
| `7`  | écriture réussie, mais l'effacement de `pendingIngestion` a échoué                                              |

Une option inconnue d'une action est une entrée incorrecte : l'action sort en `2` avant toute lecture ou écriture. `write` n'a pas de mode simulation : `sf srs validate --spec <path>` exécute, sans
backend, les contrôles que `write` fait avant de créer la moindre page.

## Exemples

```bash
# Le backend configuré est-il réellement joignable ?
sf srs validate
```

```bash
# Prévisualiser les tickets créés depuis cet Epic sans rien créer
sf srs spawn --epic https://notion.so/... --dry-run
```

```bash
# Mesurer en JSON l'écart entre spécification et code
sf srs eval --json --threshold 70
```

## Voir aussi

- [Module SRS](/fr/modules/srs) — installation et backends disponibles
- [Cycle de vie SRS](/fr/srs/lifecycle) — passage d'une page à un ticket
- [`sf status`](/fr/cli/sf-status) — vérifier si le module SRS est configuré
