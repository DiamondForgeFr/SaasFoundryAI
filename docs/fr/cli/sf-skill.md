# sf skill

Gérez le cycle de vie de la skill `tool-saasfoundry` pour les agents de code : installation, mise à jour ou suppression au niveau projet ou utilisateur.

## Utilisation

```bash
sf skill <subcommand> [options]
```

## Options

| Option      | Description                                                                                                                    | Valeur par défaut |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------- |
| `install`   | Installer la skill, au niveau projet dans un projet SaaSFoundryAI et au niveau utilisateur ailleurs                            | -                 |
| `update`    | Recopier la skill si la version embarquée est plus récente que celle installée                                                 | -                 |
| `uninstall` | Supprimer la skill de la portée choisie                                                                                        | -                 |
| `--project` | Utiliser `.claude/skills/tool-saasfoundry/` (à versionner)                                                                     | -                 |
| `--user`    | Utiliser `~/.claude/skills/tool-saasfoundry/`, pour tous les projets. Claude Code lui donne la priorité sur la copie du projet | -                 |
| `--force`   | Écraser une installation existante sans confirmation                                                                           | -                 |
| `--yes, -y` | Ignorer les confirmations, notamment en CI                                                                                     | -                 |
| `--purge`   | À la désinstallation, supprimer aussi les préférences de `~/.saasfoundry/`                                                     | -                 |

`--project` et `--user` s'excluent mutuellement.

## Portée par défaut

Claude Code donne à une skill personnelle (`~/.claude/skills/`) la priorité sur une skill de projet (`.claude/skills/`) de même nom. Une installation personnelle de `tool-saasfoundry` masque donc la
copie que le projet versionne, et continue de s'exécuter après la mise à jour de celle du projet. Dans un projet géré, la portée par défaut est le projet :

- **`install`** écrit `.claude/skills/tool-saasfoundry/` dans le dossier courant quand il contient un `.saasfoundry.json`, et `~/.claude/skills/tool-saasfoundry/` partout ailleurs. La sortie indique
  la portée choisie.
- **`update` et `uninstall`** suivent une installation : ils agissent sur la copie du projet quand le projet en a une, et sur la copie personnelle sinon, si bien qu'un projet sans copie propre se
  comporte comme avant.
- **`--project` et `--user`** décident toujours. Ne passez `--user` que si vous voulez une copie personnelle à dessein.
- Le dépôt source du CLI SaaSFoundryAI compte comme « ailleurs » : sa skill de projet est un lien vers les modèles dont le bundle est copié, et une installation ne doit pas remplacer ce lien.

[`sf status`](./sf-status.md#skills-personnelles) signale une skill personnelle qui masque déjà une skill du projet ou la concurrence, et nomme le dossier à supprimer.

## Exemples

```bash
# Dans un projet SaaSFoundryAI : installer sous .claude/skills/ (à versionner)
sf skill install
```

```bash
# Hors d'un projet : installer au niveau utilisateur
sf skill install
```

```bash
# Une copie personnelle pour tous les projets, à dessein
sf skill install --user
```

```bash
# Installer au niveau projet depuis un dossier sans manifest
sf skill install --project
```

```bash
# Actualiser la skill installée avec la version du CLI courant
sf skill update
```

```bash
# Supprimer une copie personnelle qui masque celle du projet
sf skill uninstall --user
```

```bash
# Supprimer la skill et les préférences
sf skill uninstall --purge
```

## Notes

Pour une suppression complète — les deux portées et `~/.saasfoundry/` — utilisez la commande pratique `sf uninstall --all`.

## Voir aussi

- [`sf status`](./sf-status.md#skills-personnelles) — signale les skills personnelles qui masquent celles du projet
- [Commandes du CLI](/fr/cli/sf-new)
- [Démarrage rapide](/fr/getting-started/quick-start)
