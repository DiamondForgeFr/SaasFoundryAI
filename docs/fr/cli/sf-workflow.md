# sf workflow

Gérez la configuration et les règles d'agent d'un workflow adaptatif en complexité. Utilisez le preset Team ou Solo, ou créez, enregistrez et réutilisez un modèle personnalisé.

## Utilisation

```bash
sf workflow [subcommand] [args...]
```

## Options

| Option                        | Description                                       | Valeur par défaut |
| ----------------------------- | ------------------------------------------------- | ----------------- |
| `show`                        | Afficher la configuration courante                | -                 |
| `use <template>`              | Appliquer un modèle de workflow                   | -                 |
| `set-working-branch <branch>` | Définir la branche de travail Git                 | -                 |
| `set-ai-rules`                | Configurer les règles de développement des agents | -                 |
| `validate`                    | Valider la configuration du workflow              | -                 |
| `save <template>`             | Enregistrer la configuration comme modèle         | -                 |
| `list`                        | Lister les modèles disponibles                    | -                 |
| `create <template>`           | Créer un modèle de workflow                       | -                 |
| `delete <template>`           | Supprimer un modèle                               | -                 |
| `show-template <template>`    | Afficher un modèle précis                         | -                 |

## Exemples

```bash
# Afficher la configuration courante
sf workflow show
```

```bash
# Utiliser un modèle existant
sf workflow use my-template
```

```bash
# Définir la branche de travail
sf workflow set-working-branch develop
```

```bash
# Configurer les règles des agents
sf workflow set-ai-rules
```

```bash
# Lister les modèles disponibles
sf workflow list
```

```bash
# Enregistrer la configuration courante comme modèle
sf workflow save my-template
```

## Notes

Le système adapte son niveau de contrôle à la complexité : chaque ticket est étiqueté `bug | low | medium | complex`, ce qui ajuste la profondeur de l'analyse, les validations du plan et la revue
contradictoire. Consultez le [système de workflow](/fr/workflow/introduction) pour le cycle de vie complet.

Team sépare la validation fonctionnelle (`Human testing`) de la revue de code (`In review`). Solo retire le statut Human testing distinct. Un workflow personnalisé suit l'ordre enregistré dans le
manifest.

GitHub Projects fournit le workflow V1 complet. Les adaptateurs Jira et Linear restent expérimentaux ; Notion est le backend SRS V1 complet, et non un gestionnaire de workflow complet.

## Voir aussi

- [Commandes du CLI](/fr/cli/sf-new)
- [Démarrage rapide](/fr/getting-started/quick-start)
