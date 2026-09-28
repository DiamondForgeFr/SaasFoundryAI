# sf feedback

Proposez de nouveaux modules, signalez des anomalies du CLI ou des projets générés, et votez pour les propositions de la communauté.

## Utilisation

```bash
sf feedback <subcommand> [options]
```

## Options

| Option                         | Description                                                                   | Valeur par défaut |
| ------------------------------ | ----------------------------------------------------------------------------- | ----------------- |
| `request <name>`               | Ouvrir une demande de module dans le dépôt SaaSFoundryAI                      | -                 |
| `bug`                          | Signaler une anomalie du CLI ou des scaffolds générés                         | -                 |
| `list`                         | Lister les retours (demandes de modules et anomalies du CLI ou des scaffolds) | -                 |
| `vote --list`                  | Afficher les demandes de modules classées par réactions 👍                    | -                 |
| `vote <n> up\|down\|comment`   | Ajouter une réaction ou un commentaire à la demande nº n                      | -                 |
| `--description <text>`         | Description de la demande ou de l'anomalie                                    | -                 |
| `--title <text>`               | Titre de l'anomalie                                                           | -                 |
| `--source <cli\|scaffold>`     | Surface concernée par l'anomalie                                              | -                 |
| `--auto-repro`                 | Joindre le contexte de reproduction capturé automatiquement                   | -                 |
| `--status <open\|closed\|all>` | Filtrer les tickets par état                                                  | -                 |
| `--mine`                       | Limiter la liste aux tickets que vous avez ouverts                            | -                 |
| `--limit <n>`                  | Limiter le nombre de résultats                                                | -                 |
| `--stack-filter <term>`        | Filtrer les résultats de `vote --list` par mot-clé technique                  | -                 |
| `--comment <body>`             | Corps du commentaire avec le vote `comment`                                   | -                 |
| `--json`                       | Produire une sortie JSON exploitable par une machine                          | -                 |
| `--force`                      | Ignorer la détection des doublons lors de la création                         | -                 |
| `--yes, -y`                    | Ignorer les confirmations interactives                                        | -                 |
| `--non-interactive`            | Échouer au lieu de poser une question (mode CI)                               | -                 |

## Exemples

```bash
# Demander un nouveau module
sf feedback request stripe-billing --description "Stripe subscription billing with webhooks"
```

```bash
# Signaler une anomalie du CLI avec un contexte de reproduction capturé automatiquement
sf feedback bug --source cli --title "sf update crashes on Windows" --auto-repro
```

```bash
# Lister les demandes de modules les mieux notées
sf feedback vote --list --limit 10
```

```bash
# Voter pour la demande nº 62
sf feedback vote 62 up
```

## Notes

Les demandes et anomalies sont comparées à la liste active des tickets GitHub : le CLI affiche les tickets similaires avant d'en ouvrir un nouveau. Utilisez `--force` pour passer outre.

## Voir aussi

- [Commandes du CLI](/fr/cli/sf-new)
- [Démarrage rapide](/fr/getting-started/quick-start)
