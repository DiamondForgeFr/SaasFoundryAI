# sf status

Présentez l'état courant du projet SaaSFoundryAI et les préconditions du workflow : manifest, workflow, module SRS, Git et, facultativement, CLI GitHub.

## Utilisation

```bash
sf status [--json] [--agent-friendly | --claude-friendly] [--check-gh] [--no-network]
```

## Options

| Option              | Description                                                                            | Valeur par défaut |
| ------------------- | -------------------------------------------------------------------------------------- | ----------------- |
| `--json`            | Rapport JSON ; code de sortie 1 si une vérification vaut `fail`                        | -                 |
| `--agent-friendly`  | Rapport Markdown d'initialisation pour tout hôte d'agent ; code de sortie 0            | -                 |
| `--claude-friendly` | Alias compatible de `--agent-friendly` ; les hooks existants continuent de fonctionner | -                 |
| `--no-network`      | Ignorer les contrôles dépendant du réseau                                              | -                 |
| `--check-gh`        | Vérifier la présence de `gh`, le CLI GitHub, dans `$PATH`                              | désactivé         |

## Préconditions

### Configuration

Ce que déclare le manifest et la présence des outils nécessaires autour de lui.

| Nom        | Vérification                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------- |
| `manifest` | `.saasfoundry.json` existe à la racine du projet                                                        |
| `workflow` | `workflow.tool` est défini et différent de `none`                                                       |
| `srs`      | `tools.srs.enabled` est actif avec un `rootPage` configuré ; ignoré si le module SRS n'est pas installé |
| `git`      | Le projet est un dépôt Git et son arbre de travail est propre                                           |
| `gh`       | Le CLI GitHub est présent dans `$PATH` ; contrôlé uniquement avec `--check-gh`                          |

### Exécution

Ces contrôles déterminent si le projet peut réellement **fonctionner**, ce qu'un manifest valide ne suffit pas à garantir. Un projet peut être parfaitement configuré sans avoir de `node_modules`, de
base de données accessible ni de client ORM généré. Auparavant, `sf status` le déclarait pourtant sain.

| Nom            | Vérification                                                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `dependencies` | Workspace racine en monorepo, répertoires `api` et `web` sinon                                                                         |
| `database`     | Un service répond sur le port enregistré dans le manifest ; ignoré si le projet n'héberge pas sa base ou si `--no-network` est utilisé |
| `ormClient`    | Le client Prisma généré existe sous l'API                                                                                              |

Les trois contrôles sont ignorés pour un projet qui n'est pas une application générée, comme le dépôt du CLI lui-même.

Lorsqu'un contrôle échoue, [`sf resume`](/fr/cli/sf-resume) termine l'installation.

## Exemples

```bash
# État lisible par un humain, format par défaut
sf status
```

```bash
# JSON exploitable par des scripts
sf status --json
```

```bash
# Initialisation explicite dans n'importe quel agent de code
sf status --agent-friendly --no-network
```

## Codes de sortie

- `0` — toutes les préconditions sont satisfaites, ou l'une des options de sortie destinée aux agents a été utilisée ; ces options conservent le comportement sans échec requis par les hooks
- `1` — au moins une précondition vaut `fail` avec la sortie par défaut ou `--json`

La sortie destinée aux agents peut contenir des préconditions en échec tout en terminant avec succès. L'agent doit lire ces contrôles et agir en conséquence. Lorsque `--json` est combiné à une option
destinée aux agents, le JSON prime et le comportement de sortie compatible avec les hooks est conservé, comme avec l'ancien alias.

La liste des skills est un inventaire du système de fichiers ; elle ne prouve ni leur découverte native ni l'exécution des hooks. Utilisez
[`sf agents doctor`](./sf-agents.md#diagnostiquer-les-capacites-des-agents) pour distinguer les artefacts présents des capacités réelles de l'hôte.

## Voir aussi

- [`sf new`](./sf-new.md) — créer un projet et son manifest
- [`sf update`](./sf-update.md) — installer des modules supplémentaires, notamment le SRS
- [`sf workflow`](./sf-workflow.md) — configurer l'outil de workflow
