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
| `--auto-repro`                 | Joindre un extrait de `.saasfoundry.json` et de l'environnement               | -                 |
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

## Ce que joint `--auto-repro`

`--auto-repro` ajoute un bloc de reproduction au signalement : la version du CLI, la version de Node.js, la plateforme, et un extrait du `.saasfoundry.json` du répertoire courant.

Le manifeste d'un projet généré est trop gros pour être collé tel quel. Un monorepo `full` neuf pèse environ 80 Ko, presque tout en `fileHashes`, alors que GitHub accepte au plus 65 536 caractères
dans le corps d'un ticket. Jusqu'à la 1.2.x, le fichier entier était collé et le signalement ne pouvait pas être créé. À partir de la 1.3.0, l'extrait garde ce qui détermine le chemin de code
emprunté, et rien d'autre :

| Partie du manifeste                                                                                                                  | Dans le signalement                    |
| ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| Le profil et les capacités que dérive `sf status` (`full`, `stack`, `harness`)                                                       | Copié                                  |
| `version`, `manifestVersion`, `generatedAt`, `structure`, `projectName`, `mainBranch`, `ports`                                       | Copié                                  |
| `language`, `modules` (chaque module, avec sa version et ses choix), `aiRules`                                                       | Copié                                  |
| `workflow` : outil, modèle, branches, nommage des branches, format des commits, statuts de CI locale, noms des statuts et types      | Copié                                  |
| `tools` : indicateurs SRS (activé, backend, page racine ou ingestion en attente enregistrée), noms des outils de suivi, docs, design | Copié                                  |
| `fileHashes`, `unmanagedPaths`, exclusions du scan SRS                                                                               | Compté, pas copié                      |
| `$schema`, l'URL du tableau de projet, identifiants et URL des pages SRS, noms de comptes, chemins de fichiers, empreintes           | Omis                                   |
| Un champ du manifeste que cette version du CLI ne connaît pas                                                                        | Son nom seulement, sous `unlistedKeys` |

L'extrait est construit à partir de cette liste : un champ ajouté plus tard au manifeste n'est donc jamais copié par défaut. Chaque chaîne copiée est d'abord nettoyée : jetons et clés d'API (GitHub,
OpenAI, Stripe, Slack, AWS, Google, MailerSend, Notion), JWT, en-têtes `Authorization`, identifiants dans une URL, blocs de clé privée, adresses e-mail et nom d'utilisateur d'un répertoire personnel
sont remplacés par des marqueurs comme `<github-token>` ou `/Users/<user>`. Dans le bloc `modules`, la valeur d'une clé nommée comme un secret (`token`, `secret`, `password`, `apiKey`) est retenue.
Les chaînes sont coupées à 200 caractères et les listes à 50 éléments. Le nom du projet fait partie de l'extrait, et le signalement est publié sur le dépôt GitHub de SaaSFoundryAI : utilisez
`--auto-repro` en connaissance de cause.

### Limite de taille

L'extrait pèse environ 3 Ko sur un projet complet et ne dépasse jamais environ 12 000 caractères : un manifeste qui dépasserait encore est réduit à ses champs essentiels (profil, version, structure,
nom du projet, langue, noms des modules, outil et modèle du workflow). Avant d'appeler GitHub, `sf feedback bug` mesure le corps entier face à la limite de 65 536 caractères. Si votre description ne
laisse pas la place à l'extrait complet, l'extrait réduit est utilisé ; si le corps ne tient toujours pas, la commande s'arrête, indique sa longueur et de combien elle dépasse, et suggère de
raccourcir `--description` ou de retirer `--auto-repro`. Rien n'est envoyé dans ce cas.

Quand un appel à `gh` échoue, l'erreur affichée est la réponse de `gh`. La ligne de commande, qui contient le corps du ticket, n'est jamais imprimée.

Le manifeste complet n'est joint nulle part : les `fileHashes` servent à `sf update` et ne changent rien à ce qu'il faut pour reproduire, et publier le fichier entier publierait aussi les noms de
comptes et les URL du tableau et des pages SRS. Si un mainteneur a besoin d'une partie du fichier, il la demandera dans le ticket.

## Voir aussi

- [Commandes du CLI](/fr/cli/sf-new)
- [Démarrage rapide](/fr/getting-started/quick-start)
