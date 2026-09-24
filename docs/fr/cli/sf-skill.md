# sf skill

Gérez le cycle de vie de la skill `tool-saasfoundry` pour les agents de code : installation, mise à jour ou suppression au niveau utilisateur ou projet.

## Utilisation

```bash
sf skill <subcommand> [options]
```

## Options

| Option      | Description                                                                               | Valeur par défaut |
| ----------- | ----------------------------------------------------------------------------------------- | ----------------- |
| `install`   | Installer la skill, au niveau utilisateur par défaut                                      | -                 |
| `update`    | Recopier la skill si la version embarquée est plus récente que celle installée            | -                 |
| `uninstall` | Supprimer la skill de la portée choisie                                                   | -                 |
| `--project` | Utiliser `.claude/skills/tool-saasfoundry/` (à versionner) plutôt que `~/.claude/skills/` | -                 |
| `--force`   | Écraser une installation existante sans confirmation                                      | -                 |
| `--yes, -y` | Ignorer les confirmations, notamment en CI                                                | -                 |
| `--purge`   | À la désinstallation, supprimer aussi les préférences de `~/.saasfoundry/`                | -                 |

## Exemples

```bash
# Installer la skill au niveau utilisateur
sf skill install
```

```bash
# Installer au niveau projet, partager avec l'équipe et versionner dans Git
sf skill install --project
```

```bash
# Actualiser la skill installée avec la version du CLI courant
sf skill update
```

```bash
# Supprimer la skill et les préférences
sf skill uninstall --purge
```

## Notes

Pour une suppression complète — les deux portées et `~/.saasfoundry/` — utilisez la commande pratique `sf uninstall --all`.

## Voir aussi

- [Commandes du CLI](/fr/cli/sf-new)
- [Démarrage rapide](/fr/getting-started/quick-start)
