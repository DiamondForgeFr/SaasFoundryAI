# sf modules

Parcourez le catalogue de modules SaaSFoundryAI, consultez leurs métadonnées et classez-les selon une intention exprimée en langage naturel.

## Utilisation

```bash
sf modules <subcommand> [options]
```

## Options

| Option             | Description                                                              | Valeur par défaut |
| ------------------ | ------------------------------------------------------------------------ | ----------------- |
| `list`             | Lister tous les modules et leur état d'installation                      | -                 |
| `info <name>`      | Afficher les métadonnées détaillées d'un module                          | -                 |
| `match "<intent>"` | Classer les modules selon leur adéquation avec une description naturelle | -                 |
| `--json`           | Produire du JSON sur toutes les sous-commandes                           | -                 |

## Exemples

```bash
# Lister tous les modules du catalogue
sf modules list
```

```bash
# Examiner le module email au format JSON
sf modules info email --json
```

```bash
# Trouver les modules adaptés à l'envoi d'e-mails transactionnels
sf modules match "send transactional emails"
```

## Notes

Le catalogue alimente les garde-fous contre la réinvention : la skill `sf-tool-saasfoundry` appelle `sf modules match` avant que l'agent de code envisage de construire un nouveau module de zéro.

## Voir aussi

- [Commandes du CLI](/fr/cli/sf-new)
- [Démarrage rapide](/fr/getting-started/quick-start)
