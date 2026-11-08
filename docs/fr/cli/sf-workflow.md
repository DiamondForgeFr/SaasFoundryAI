# sf workflow

Gérez la configuration et les règles d'agent d'un workflow adaptatif en complexité. Team et Solo sont les presets v1 protégés de bout en bout ; les modèles personnalisés constituent une surface de
configuration avancée.

## Utilisation

```bash
sf workflow [subcommand] [args...]
```

## Options

| Option                          | Description                                                                                                                                                      | Valeur par défaut |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `show`                          | Afficher la configuration courante                                                                                                                               | -                 |
| `use <template>`                | Appliquer un modèle de workflow en gardant le board actuel ; `--project-url <url>` en rattache un, `--create-board` en crée un sur GitHub Projects               | -                 |
| `set-working-branch <branch>`   | Définir la branche de travail Git ; une cible de PR qui la suivait la suit encore                                                                                | -                 |
| `set-pr-target-branch <branch>` | Définir la branche visée par les pull requests                                                                                                                   | -                 |
| `set-local-ci <context...>`     | Enregistrer les statuts de commit qui doivent être verts avant la revue (garde-fou de CI locale) ; `--from-molten`, `--none` ou `--clear` à la place d'une liste | -                 |
| `set-ai-rules`                  | Configurer les règles de développement des agents                                                                                                                | -                 |
| `validate`                      | Valider la configuration du workflow                                                                                                                             | -                 |
| `save <template>`               | Enregistrer la configuration comme modèle                                                                                                                        | -                 |
| `list`                          | Lister les modèles disponibles                                                                                                                                   | -                 |
| `create <template>`             | Créer un modèle de workflow                                                                                                                                      | -                 |
| `delete <template>`             | Supprimer un modèle                                                                                                                                              | -                 |
| `show-template <template>`      | Afficher un modèle précis                                                                                                                                        | -                 |

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
# Exiger ces statuts de commit sur la tête d'une pull request avant la revue
sf workflow set-local-ci local-unit local-e2e
```

```bash
# Enregistrer les statuts local-<job> des jobs que .molten/project.json déclare
sf workflow set-local-ci --from-molten
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

Team sépare la validation fonctionnelle (`Human testing`) de la revue de code (`In review`). Solo retire le statut Human testing distinct. Un modèle personnalisé enregistre une liste ordonnée de
statuts, mais la v1 ne génère ni documents complets ni garde-fous arbitraires pour de nouveaux noms. Étendez le skill installé avant d'en faire un contrat de livraison.

`sf workflow validate` contrôle les champs locaux du manifeste en v1 ; il ne compare pas le board distant configuré.

### Garde-fou de CI locale (`set-local-ci`)

Avec GitHub Projects, une pull request ouverte pour la revue (`create-pr` sans `--draft`), marquée prête (`ready-pr`) ou passée en Human testing exige que les statuts de CI locale du projet soient
verts sur son commit de tête exact. Ces statuts viennent de l'une de trois sources, dans cet ordre, et `sf workflow show` ainsi que `sf status` indiquent laquelle s'applique :

1. **Le manifeste** : `workflow.localCi.requiredStatuses`. Il l'emporte toujours. `set-local-ci <context...>` enregistre une liste explicite (ni vide, ni doublon).
2. **Un pipeline Molten** : la clé étant absente, `.molten/project.json` déclare au moins un job dans `ci.jobs` et `"ci": { "statuses": "github" }`. Chaque job `<nom>` publie le statut `local-<nom>`,
   et tous sont exigés. La liste est dérivée à chaque exécution : un job ajouté au pipeline est exigé aussitôt.
3. **Aucune des deux** : le statut `AI testing / Local CI`, que l'agent publie avec `workflow-cli.sh ai-status <ticket> "Local CI" success` une fois la suite propre au projet verte.

| Commande                     | Effet                                                                                                                                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `set-local-ci <context...>`  | Enregistre la liste. Le manifeste l'emporte alors sur les deux autres sources.                                                                                                         |
| `set-local-ci --from-molten` | Enregistre la liste `local-<job>` de `.molten/project.json`. Refusé quand le fichier manque, est mal formé, ne déclare aucun job ou ne publie pas vers GitHub. La liste est **figée**. |
| `set-local-ci --none`        | Enregistre une liste vide : un « ce projet n'a pas de CI locale » délibéré. Le garde-fou affiche un avis et ne vérifie rien.                                                           |
| `set-local-ci --clear`       | Retire `workflow.localCi` : le garde-fou dérive de nouveau sa liste (source 2, puis 3).                                                                                                |

Une liste enregistrée est figée : un job ajouté ensuite à `.molten/project.json` n'est exigé qu'une fois la liste enregistrée de nouveau (`--from-molten`), ou après `--clear` pour suivre le pipeline.
La commande écrit un champ qui existe déjà dans le manifeste : aucune migration de manifeste. Versionnez la modification avec votre branche. Seul l'outil GitHub Projects applique le garde-fou.

GitHub Projects fournit le workflow V1 complet. Les adaptateurs Jira et Linear restent expérimentaux ; Notion est le backend SRS V1 complet, et non un gestionnaire de workflow complet.

## Voir aussi

- [Commandes du CLI](/fr/cli/sf-new)
- [Démarrage rapide](/fr/getting-started/quick-start)
