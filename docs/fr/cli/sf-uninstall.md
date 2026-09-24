# sf uninstall

Supprimez entièrement les artefacts SaaSFoundryAI de la machine : la skill dans les deux portées et les préférences de `~/.saasfoundry/`. L'option `--all` est obligatoire.

## Utilisation

```bash
sf uninstall --all [--yes]
```

## Options

| Option      | Description                                                                                | Valeur par défaut |
| ----------- | ------------------------------------------------------------------------------------------ | ----------------- |
| `--all`     | Obligatoire : supprimer la skill des portées utilisateur et projet, puis `~/.saasfoundry/` | -                 |
| `--yes, -y` | Ignorer la demande de confirmation                                                         | -                 |

## Exemples

```bash
# Désinstaller complètement les artefacts SaaSFoundryAI
sf uninstall --all
```

```bash
# Mode CI, sans question interactive
sf uninstall --all --yes
```

## Notes

Pour ne supprimer qu'une portée, utilisez `sf skill uninstall`. `sf uninstall` conserve le package npm ; supprimez-le avec `npm uninstall -g saasfoundryai-cli`.

## Voir aussi

- [Commandes du CLI](/fr/cli/sf-new)
- [Démarrage rapide](/fr/getting-started/quick-start)
