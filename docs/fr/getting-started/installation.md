# Installation

## Commencer par votre situation

SaaSFoundryAI prend en charge trois points de départ. Avant d'exécuter une commande, choisissez celui qui décrit les fichiers devant vous.

| Point de départ                                                | Entrée sûre                                                                     | Résultat                                                                                                                            |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Un projet SaaSFoundryAI géré contient déjà `.saasfoundry.json` | `sf status --agent-friendly --no-network`, puis `sf update` ou `sf agents`      | Le manifest existant reste la source de vérité. Les mises à jour s'appliquent sans recréer le projet.                               |
| Un espace vide ou un nouveau produit                           | `sf new`                                                                        | Vous choisissez le socle technique, le harness de développement, ou les deux.                                                       |
| Un dépôt existant sans manifest SaaSFoundryAI                  | Lisez-le, puis choisissez `sf new --profile harness` ou un scaffold `full` neuf | Un projet conservé reçoit le harness sur place. Un POC jetable est préservé comme référence avant la création d'un scaffold propre. |

Les choix détaillés sont présentés ci-dessous. Commencez par choisir entre [CLI interactif et configuration pilotée par un agent](/fr/getting-started/setup-paths). Le
[démarrage rapide](/fr/getting-started/quick-start) reste l'exemple exécutable le plus court.

## Configuration pilotée par un agent

Avec Claude Code, transmettez cette phrase à l'assistant depuis le dossier de travail :

> Install the SaaSFoundryAI skill from https://github.com/DiamondForgeFr/SaasFoundryAI

Le bootstrap actuel au niveau utilisateur installe `tool-saasfoundry` dans le dossier de skills de Claude Code :

```bash
npx saasfoundryai-cli@beta skill install --yes --force
```

Utilisez `--project` pour placer cette méta-skill dans le dépôt afin de la relire et de la partager avec l'équipe.

Ce bootstrap en une phrase est actuellement natif pour Claude Code. Avec Codex, Gemini CLI, Kimi Code, Qwen Code ou un autre hôte d'agent, suivez le chemin CLI ci-dessous, sélectionnez les profils
appropriés, puis ouvrez le projet généré dans cet hôte. Le harness prend en charge plusieurs profils ; installer la méta-skill destinée à l'assistant et configurer le harness du projet sont deux
opérations distinctes.

## Prérequis

- **Node.js 24.19.0**, version épinglée dans les `.nvmrc` générés
- **npm 11 ou plus récent**
- **Git**
- **Docker** si vous choisissez des services de base ou de stockage gérés par Docker
- au moins un runtime d'agent de code pour le développement assisté

Les projets générés utilisent les workspaces npm et un `package-lock.json`. yarn et pnpm ne sont pas validés avec le graphe de dépendances généré.

Vous pouvez exécuter le CLI sans installation globale :

```bash
npx saasfoundryai-cli@beta new
```

Ou l'installer globalement :

```bash
npm install -g saasfoundryai-cli@beta
sf --version
```

## Situation 1 : projet géré existant

Un projet géré contient `.saasfoundry.json`. Examinez-le avant toute modification :

```bash
sf status --agent-friendly --no-network
sf agents list --json
```

Utilisez `sf update` pour actualiser les fichiers SaaSFoundryAI ou ajouter des modules pris en charge. Utilisez `sf agents` pour modifier les déclarations d'agents :

```bash
# Personal to this checkout; tracked files stay unchanged
sf agents enable codex

# Shared through the repository as a reviewable diff
sf agents enable codex --scope shared

# Replace one scope's declaration with an exact non-empty set
sf agents replace claude-code codex --scope shared

# Refresh generated agent surfaces after a harness update
sf agents refresh
```

La portée locale est utilisée par défaut et reste privée au checkout ou worktree courant. La portée partagée écrit la déclaration et les surfaces générées que l'équipe peut relire et commiter. Activer
un profil n'en désactive aucun autre.

## Situation 2 : espace de travail vide

Lancez le parcours interactif :

```bash
sf new
```

La première décision concerne le profil d'installation :

| Profil    | Installation                                                                           | Quand le choisir                                                                  |
| --------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `full`    | Socle technique, workflow, skills, options SRS et instructions des agents              | Pour créer un produit neuf ou reconstruire un POC jetable                         |
| `harness` | Harness de développement et de collaboration dans le dépôt courant                     | Pour conserver un code existant                                                   |
| `stack`   | Scaffold technique et utilitaires principaux, sans configuration du workflow ni du SRS | Pour obtenir volontairement le socle technique sans harness de collaboration géré |

Avec `full` et `harness`, sélectionnez un ou plusieurs profils d'agents enregistrés. Exemple scripté :

```bash
sf new --non-interactive \
  --profile full \
  --project-name my-saas \
  --structure monorepo \
  --agents claude-code,codex \
  --setup-repo local \
  --db-setup docker \
  --db-type postgresql \
  --email-service none \
  --s3-setup manual \
  --no-analytics
```

Sans `--agents`, la déclaration historique Claude Code est conservée. L'écran final indique les profils effectifs et leurs points d'entrée sans prétendre que les runtimes sont installés ou qu'ils les
ont chargés.

### Choisir le preset de workflow

Le profil d'installation et le preset de workflow répondent à deux questions différentes. `full`, `harness` et `stack` déterminent ce qui est installé ; **Team**, **Solo** et **Custom** déterminent
comment les tickets avancent.

- **Team** utilise les sept statuts. `Human testing` correspond au test fonctionnel de la fonctionnalité ; `In review` correspond ensuite à la revue de code.
- **Solo** retire la colonne Human testing distincte. La validation fonctionnelle manuelle reste nécessaire, mais elle est réalisée pendant la revue de la PR avant le merge.
- **Custom** permet d'enregistrer et synchroniser des statuts avancés. En v1, seuls Team et Solo génèrent des documents de statut et garde-fous complets ; un parcours personnalisé exige d'étendre le
  skill installé.

Pour la V1, GitHub Projects fournit le contrat de workflow complet. Les adaptateurs Jira et Linear sont expérimentaux. Notion fournit le backend SRS V1 complet, et non un tracker de workflow complet.

## Situation 3 : dépôt existant ou POC

Décidez d'abord si le code existant reste le produit.

### Conserver et poursuivre le dépôt existant

Installez le harness sur place :

```bash
cd existing-project
sf new --profile harness
```

Ce chemin ne crée aucun dossier de projet et ne remplace ni l'API, ni le frontend, ni la base, ni le stockage, ni le module e-mail. Il dépose le harness de collaboration dans le dépôt existant et
écrit un manifest géré minimal.

Si ce projet doit ensuite recevoir un socle technique SaaSFoundry propre dans des chemins sans conflit, prévisualisez la promotion additive :

```bash
sf update --target-profile full --dry-run --json
```

Cette opération ne fusionne ni ne remplace les fichiers techniques existants de l'application externe. Si le code courant reste le produit, conservez le profil harness dès que l'aperçu signale des
conflits.

### Reconstruire depuis un POC jetable

Laissez d'abord l'analyse `tool-saasfoundry` lire le code. Examinez ses conclusions et son plan de déplacement. Après approbation explicite seulement, elle place l'expérience existante sous `POC/` et
crée à côté un projet `full` propre. L'ancien code reste disponible comme référence et n'est jamais supprimé ni écrasé silencieusement.

Ne lancez pas un scaffold complet dans le dossier d'un POC et ne déplacez pas un dépôt que l'utilisateur souhaite conserver.

## Choisir les profils d'agents de code

Les profils identifient les outils de code et leurs surfaces de découverte d'instructions. Ils ne choisissent ni fournisseur ou nom de modèle, ni identifiant API, ni niveau de raisonnement.

Les identifiants enregistrés sont `claude-code`, `codex`, `kimi`, `gemini-cli`, `qwen-code` et `generic`. Consultez la
[matrice canonique des profils `sf agents`](/fr/cli/sf-agents#profils-d-outils-et-fournisseurs-de-modeles) pour les preuves et limites actuelles.

Après l'installation :

```bash
sf agents list --json
sf agents doctor codex
sf status --agent-friendly --no-network
```

`list` indique les déclarations partagées, locales et effectives. `doctor` examine des indices statiques bornés. Aucune de ces commandes ne prouve l'authentification, les autorisations, les hooks,
l'activation native des skills ni la disponibilité d'un modèle.

## Plateformes

La suite teste le CLI et les workflows shell générés sous macOS et Linux. Sous Windows, utilisez WSL pour retrouver le même environnement. En V1, `sf update --target-profile full` prend explicitement
en charge macOS, Linux et WSL. Windows natif est refusé avant toute mutation, car la transition de profil exige des garanties de durabilité des répertoires qui n'y sont pas encore disponibles.
D'autres commandes natives peuvent fonctionner, mais `sf agents doctor --check-runtime` indique `not-checked` pour les extensions d'exécutables : vérifiez l'hôte réel au lieu de considérer la présence
d'un fichier comme preuve d'exécution.

cmux est un espace de travail macOS facultatif. Il n'est requis ni par SaaSFoundryAI ni par aucun profil d'agent.

## Documentation après installation

Lancez localement la documentation embarquée, sans dépendre d'un site hébergé :

```bash
sf docs
```

Le projet généré contient également son `README.md`, la documentation du harness et les points d'entrée des agents. Suivez le tutoriel [Premier projet](/fr/getting-started/first-project) pour un
parcours complet et la [coexistence des agents](/fr/guide/agent-coexistence) pour le protocole strict de vérification native et de transfert.
