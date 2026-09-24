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
| `validate`     | Tester rapidement le backend configuré au moyen de `adapter.init()`                        |
| `browse`       | Lister en JSON les enfants directs d'une page parente                                      |
| `draft`        | Produire un brouillon depuis des pages du backend ou une analyse du code                   |
| `write`        | Appliquer un fichier de spécification `DraftCandidate[]` via l'adaptateur                  |
| `versions`     | Lister les versions déclarées dans le SRS, source des propositions de périmètre de release |
| `spawn`        | Transformer une page Epic en tickets                                                       |
| `normalize`    | Énumérer les pages FR d'un Epic et créer les sous-tickets Story                            |
| `apply-update` | Appliquer un correctif du hook d'évaluation conversationnel, en ajout uniquement           |
| `eval`         | Mesurer l'actualité du SRS par rapport au code                                             |

### Détails

```bash
sf srs validate [manifest]
sf srs browse --parent <id> [--manifest <path>]

sf srs draft --from notion-pages --ids <id1,id2,...> [--manifest <path>]
sf srs draft --from codebase [--path <dir>] [--manifest <path>]

sf srs write --spec <path> [--manifest <path>] [--no-clear-pending]
sf srs versions [--root-page <id>] [--manifest <path>]

sf srs spawn --epic <page-url-or-id> [--ticket <n>] [--version <title-url-or-id>]
             [--milestone <name>] [--dry-run] [--manifest <path>] [--bypass-reason <text>]

sf srs normalize [--feature <url-or-id>] [--version-name <name>] [--apply]
                 [--manifest <path>] [--root-page <id>]

sf srs apply-update [--patch <path>] [--manifest <path>]
sf srs eval [--path <dir>] [--root-page <id>] [--threshold <pct>] [--json] [--manifest <path>]
```

L'option `--milestone` de `spawn` **déclare la release dans laquelle ces tickets seront livrés** : le milestone est créé ou réutilisé, la page de version lui est associée et tous les tickets générés
le rejoignent.

## Options communes

| Option              | Description                  | Valeur par défaut   |
| ------------------- | ---------------------------- | ------------------- |
| `--manifest <path>` | Fichier manifest à consulter | `.saasfoundry.json` |

## Codes de sortie

Toutes les actions partagent le même contrat. Un script peut donc réagir à la cause plutôt qu'au texte d'un message :

| Code | Signification                                                      |
| ---- | ------------------------------------------------------------------ |
| `0`  | succès                                                             |
| `2`  | entrée incorrecte                                                  |
| `3`  | backend absent                                                     |
| `4`  | backend inconnu                                                    |
| `5`  | erreur d'exécution                                                 |
| `6`  | écriture partielle ; la sortie contient un `rollbackHint`          |
| `7`  | écriture réussie, mais l'effacement de `pendingIngestion` a échoué |

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
