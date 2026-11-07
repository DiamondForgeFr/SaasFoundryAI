# sf status

Présentez l'état courant du projet SaaSFoundryAI et les préconditions du workflow : manifest, workflow, module SRS, Git, CLI qui répond, fichiers d'instructions des agents, routage, agents de palier,
skills personnelles qui masquent celles du projet et, facultativement, CLI GitHub. Le rapport énonce des faits ; les règles pour le lire sont dans les instructions du projet.

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

### Instructions des agents

Ces contrôles déterminent si les agents de code déclarés par le projet (`sf agents list`) lisent `AGENTS.md` en entier. Chaque problème est un `warn` : l'agent démarre, mais sans tout ou partie des
règles du projet, et rien ne le signale dans l'hôte. Un contrôle est ignoré quand son agent n'est pas déclaré ; `instructionReferences` ne vise aucun agent et n'est ignoré que si la déclaration n'a
pas pu être lue.

| Nom                     | Vérification                                                                                                                                                                                                                                                                                                                                           | Remédiation                                                                                                                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `instructionShadowing`  | Claude Code : aucun `CLAUDE.md`, `.claude/CLAUDE.md` ni `CLAUDE.local.md` dans le projet, ses dossiers d'applications ou un dossier parent. Claude Code les lit à la place d'`AGENTS.md` ; chaque fichier trouvé est listé avec son chemin                                                                                                             | Reporter son contenu dans `AGENTS.md` puis le supprimer. `sf update` le fait pour les fichiers laissés par un ancien harness ; un fichier au-dessus du projet est à déplacer vous-même                                                            |
| `claudeCodeVersion`     | Claude Code : le `claude` du `$PATH` est en version 2.1.277 ou plus, la première qui lit `AGENTS.md`. Lu avec `claude --version`, en local et sans appel réseau, y compris avec `--no-network`. Ignoré si `claude` n'est pas dans le `$PATH`                                                                                                           | `claude update`                                                                                                                                                                                                                                   |
| `codexInstructionSize`  | Codex : ce que Codex charge à la racine et dans chaque dossier d'application doté d'un `AGENTS.md` tient dans `project_doc_max_bytes` : la valeur fixée par `.codex/config.toml`, sinon ses 32 Kio par défaut. Le calcul additionne chaque `AGENTS.md` (ou `AGENTS.override.md`) depuis la racine Git, et les fichiers qu'ils importent avec `@chemin` | Lancer `sf agents refresh` ou `sf update`, qui relèvent `project_doc_max_bytes` dans `.codex/config.toml` (voir [`sf update`](./sf-update.md#limite-dinstructions-de-codex)), ou déplacer le détail dans des docs ou skills cités par `AGENTS.md` |
| `instructionReferences` | Aucun agent en particulier : l'`AGENTS.md` du projet et de chaque application ne cite aucun `CLAUDE.md` qui n'existe pas, comme le font `apps/api/CLAUDE.md` ou une ligne d'arborescence `└── CLAUDE.md` après un déplacement par la version 1.1.0. Chaque mention est listée avec son fichier et sa ligne                                             | Faire pointer chaque mention vers l'`AGENTS.md` qui a remplacé le fichier, ou la supprimer. `sf update` les réécrit en déplaçant un `CLAUDE.md` ; un projet déjà déplacé se corrige à la main                                                     |

`--json` renvoie aussi les faits derrière ces contrôles sous `instructions` : les agents effectifs, les chemins qui masquent `AGENTS.md`, la version de Claude Code lue, les octets comptés par dossier
avec les fichiers qui les composent, plus `codexLimit` quand `.codex/config.toml` fixe `project_doc_max_bytes`, et les `CLAUDE.md` manquants qu'un `AGENTS.md` cite (`staleReferences` : fichier, ligne,
chemin tel qu'écrit et fichier visé).

### Le CLI qui répond

La sortie destinée aux agents nomme le CLI qui l'a produite sur une ligne `cli:`, juste après la ligne `project:`, et `--json` la porte sous la forme d'un objet `cli` : `cli: 1.1.0 (package)` pour un
package installé, `cli: 1.1.0 (development checkout: /chemin/vers/SaaSFoundry @ 415509ae)` pour un checkout lié. Le rapport n'énonce que des faits. Il ne se termine plus par un bloc « How to use this
output » d'impératifs : ce qu'il faut faire d'un `fail`, d'un `warn` ou d'un `skip`, et la règle selon laquelle la langue de la conversation n'est pas le signal de la langue des artefacts, se lisent
dans la section **Reading the project status** de la région générée d'`AGENTS.md`, là où se trouvent les autres règles.

Deux préconditions lisent cet objet `cli`. Aucune n'exécute de processus.

| Nom          | Vérification                                                                                                                                                                                                                                                                                                                                                                                                    | Remédiation                                                                                                                                                                                    |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cliVersion` | Le CLI n'est pas plus ancien que ce qui a écrit le projet en dernier : sa version est au moins le `version` du projet (le CLI qui l'a mis à jour en dernier), et la version du harness du projet ne dépasse pas celle que ce CLI installe. Les préversions se comparent comme le fait semver (`1.1.0-rc.1` est plus ancienne que `1.1.0`). Le détail nomme les deux numéros et le canal                         | `npm install -D saasfoundryai-cli@<version>` dans le projet (ou `npm install -g saasfoundryai-cli@latest`) ; pour un checkout de développement, le mettre à jour puis y lancer `npm run build` |
| `cliBuild`   | Dans le dépôt du CLI SaaSFoundryAI uniquement : `dist/index.js` existe et est plus récent que chaque fichier de `src/` (tests exclus), car `bin/sf.js` exécute `dist/` et rien ne le reconstruit après un pull. Elle compare les dates de modification : un pull, un checkout ou une modification locale se voient, et un build commité ensuite ne déclenche pas de fausse alerte. Absente de tout autre projet | `npm run build`                                                                                                                                                                                |

Les deux sont absentes quand l'appelant ne dit pas quel CLI s'exécute. Un CLI plus ancien que ces contrôles ne peut pas les rapporter, c'est pourquoi le hook de début de session ci-dessous cesse
d'exécuter un `sf` nu.

### Le hook de début de session

Claude Code exécute `sf status` pour vous au début d'une session et injecte sa sortie. Le hook de `.claude/settings.json` n'appelle pas un `sf` nu, c'est-à-dire ce qui vient en premier dans le PATH :
un SaaSFoundryAI plus ancien dont le rapport n'a pas les lignes `delegation:`, `routing:` et `local-ci:`, ou le CLI Salesforce. Il exécute le CLI que le projet résout, dans cet ordre :

1. `node_modules/.bin/saasfoundryai`, le CLI que le projet a installé ;
2. `bin/sf.js`, quand le projet est le dépôt du CLI SaaSFoundryAI lui-même (son `package.json` le nomme) et que `dist/index.js` est construit ;
3. `saasfoundryai` dans le PATH.

Le `node_modules/.bin/sf` d'un projet n'est pas essayé, car ce peut être le CLI Salesforce. Le hook se place dans `CLAUDE_PROJECT_DIR` (le dossier courant quand l'hôte n'en définit pas), exécute
`status --agent-friendly --no-network` avec l'avertissement de skills périmés réduit au silence, et termine toujours avec le code 0. Il affiche le rapport, et quand il ne peut pas en produire un, il
affiche un fait et non une instruction : `- cli: no SaaSFoundryAI CLI found (…)`, `- cli: bin/sf.js is not built (run npm run build); trying saasfoundryai on the PATH`, ou
`- status: <commande> exited <code>`.

`sf update` et `sf agents refresh` remplacent la commande `sf status --claude-friendly --no-network` nue qu'écrivaient les versions précédentes (voir
[`sf update`](./sf-update.md#capture-des-delegations-et-permissions-harness-v5)). Dans `.codex/hooks.json`, le même remplacement a lieu là où un projet a câblé la commande nue à la main ; aucun hook
n'est ajouté à un fichier qui n'en a pas.

### Le dépôt du CLI lui-même

Le dépôt du CLI SaaSFoundryAI exécute le harness géré sur lui-même et ne génère aucune application. Son manifest porte toujours `modules.email = { provider: "none" }`, que la migration de manifest 002
écrit dans tout manifest qui a un objet `modules`, y compris sans stack. Sur un projet `cli`, ce bloc avec un fournisseur `none` et aucun marqueur de base de données, de stockage ou d'analytics à côté
n'est pas une stack technique : le projet se lit `harness` (stack `absent`), pas `inconsistent`. Tout autre marqueur, ou un fournisseur d'envoi d'e-mails, reste lu comme contradictoire. Dans le dépôt
du CLI lui-même (le package nommé `saasfoundryai-cli` avec son `bin/sf.js` et son `src/`), la raison du profil le dit, et `sf status` ne propose aucun aperçu `sf update --target-profile full`.
`sf update` y continue de déposer les skills de stack.

### Accord de délégation

Sur un projet doté d'un bloc harness, la sortie destinée aux agents porte une ligne `delegation:` et `--json` un objet `delegation` : l'accord du développeur pour déléguer la livraison des tickets à
des agents en arrière-plan (voir [`sf agents delegation`](./sf-agents.md#livraison-deleguee-des-tickets-sf-agents-delegation)). Une session l'apprend par le statut qu'elle lit déjà au démarrage. La
ligne indique la réponse effective, la couche dont elle vient et sa date, par exemple `delegation: allowed (shared, 2026-10-19T15:34:52.506Z)`. Quand un clone déroge au défaut de l'équipe, elle
devient `delegation: declined (local, <date>; shared team default: allowed)`, et `not-asked` tant que personne n'a répondu. Une réponse locale corrompue s'affiche `unreadable (…)` et ne fait jamais
échouer le statut.

### Routage automatique

Sur les mêmes projets, une ligne `routing:` (et un objet `routing` dans `--json`) indique où en est le routage dans ce clone (voir
[`sf agents routing`](./sf-agents.md#delegations-mesurees-et-routage-ajuste)). Elle commence par la grille et ce que le projet y remplace :
`grid v1, 2 overrides (multi-file-feature → plan; tier build for claude-code)` donne la version de la grille que ce CLI livre, puis une entrée par type que `modules.harness.routing` envoie vers un
autre palier et une par palier auquel il donne d'autres candidats (`grid v1, 0 overrides` quand le projet garde le routage livré). `--json` les porte dans l'objet `routing` sous `gridVersion` et
`overrides` (`{ kinds: [{ kind, tier }], tiers: [{ tier, providers }] }`), à côté de `tierAgents` ([plus bas](#agents-de-palier)). La ligne continue avec les déplacements que l'ajustement a faits et
que personne n'a encore promus, pour qu'une session sache que la route qu'elle obtient n'est pas celle livrée, par exemple
`routing: grid v1, 0 overrides; 1 local automatic adjustment not promoted (multi-file-feature → fix for claude-code, escalate on 2026-10-20; sf agents routing report, promote or reset)`. Elle nomme un
type que l'ajustement a examiné et ne peut pas déplacer (`terminal-ci (claude-code) held: top-of-ladder since 2026-10-20`) et compte ceux qui attendent seulement des preuves. Elle dit aussi, pour
chaque agent de code déclaré, si les hooks qui enregistrent chaque délégation sont en place **et peuvent s'exécuter** : `claude-code capture enforced` seulement quand le hook est déclaré et que le CLI
du projet répond à `agents outcome capture` ; `capture hook declared but no CLI can run it` sinon (installez `saasfoundryai-cli` dans le projet, ou mettez `saasfoundryai` dans le PATH : d'ici là les
délégations ne sont pas enregistrées) ; `codex capture declared` quand le hook est là mais que Codex doit d'abord l'approuver ; `capture hook outdated` pour le hook `sf` nu du premier build ou celui
que la v1.1.0 a livré ; `capture hook missing` (`run sf agents refresh --scope shared`) ; ou `not enforced` pour un hôte sans hooks, dont les délégations s'enregistrent à la main. Une couche locale
endommagée s'affiche `unreadable (…)` et ne fait jamais échouer le statut.

### Erreurs de capture

Les hooks qui enregistrent les délégations s'exécutent avec leur sortie écartée et sortent avec 0 : une capture qui échoue (une charge illisible, un registre impossible à écrire, un ajustement de
routage sauté) ne laissait donc aucune trace, et le routage apprenait de moins de résultats qu'on ne lui en donnait. La capture journalise maintenant chaque échec dans `capture-errors.jsonl`, à côté
du registre dans le répertoire Git du clone (voir [capture et signaux](./sf-agents.md#capture-et-signaux)), et `sf status` compte les erreurs des **7 derniers jours**, si bien qu'un échec ancien
n'avertit pas pour toujours :

- la ligne `routing:` gagne `; 2 capture errors in 7 days, last 2026-11-06: <message>` **seulement quand il y en a au moins une** ; `--json` porte `routing.captureErrors` sous la forme
  `{ count, since, last? }`, où `last` est `{ at, host, event, stage, message }` (additif : un rapport construit sans le journal omet le champ) ;
- la précondition `captureErrors`, « Delegation capture records every run », est un `warn` avec le nombre, la dernière erreur et l'emplacement du journal, `ok` quand la fenêtre n'en contient aucune,
  et ignorée sans harness, quand le routage est illisible, ou pour un rapport qui n'a pas lu le journal. La remédiation renvoie au journal et à [`sf agents routing report`](./sf-agents.md#le-rapport),
  qui affiche le même nombre.

Il ne fait que lire le journal : rien n'est écrit, et un journal absent ou illisible compte pour vide, si bien que le statut n'échoue jamais à cause de lui. Hors d'un dépôt Git il n'y a pas de
journal.

### Agents de palier

Les agents de délégation que [`sf agents refresh`](./sf-agents.md#agents-de-palier) écrit sous `.claude/agents/` et `.codex/agents/` portent chacun un modèle et un effort. Modifiez-en un, supprimez-en
un, ou passez à un CLI dont la grille est plus récente : une délégation s'exécute alors sur une route que le routage ne dit plus, sans que rien ne le signale dans l'hôte. `tierAgents` compare chaque
agent de palier des agents de développement déclarés que la grille route à ce qu'un refresh écrirait maintenant, d'après la grille que ce CLI livre et `modules.harness.routing`. Il se contente de lire
les fichiers : il n'exécute aucun code du projet et n'écrit rien. `--json` les liste sous `routing.tierAgents` sous la forme `{ path, state }`.

| État       | Signification                                                                                                                                                                                                                                                                                                          | Remédiation                                                                                                                                                                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ok`       | Le fichier est exactement ce qu'un refresh écrirait                                                                                                                                                                                                                                                                    | Aucune                                                                                                                                                                                                                                                            |
| `missing`  | Le fichier n'existe pas                                                                                                                                                                                                                                                                                                | `sf agents refresh --scope shared`                                                                                                                                                                                                                                |
| `outdated` | Personne ne l'a modifié : le fichier est ce qu'un refresh précédent a écrit, et la grille ou les surcharges ont changé depuis                                                                                                                                                                                          | `sf agents refresh --scope shared`                                                                                                                                                                                                                                |
| `edited`   | Le fichier n'est ni le rendu ni une référence enregistrée (`fileHashes` dans `.saasfoundry.json`, ou l'inventaire privé de ce clone pour un agent de palier écrit par une configuration locale), ou aucune référence n'est enregistrée. Un lien, ou tout fichier qu'un refresh refuse de toucher, compte comme modifié | Le restaurer, ou reporter la modification dans `modules.harness.routing`, puis `sf agents refresh --scope shared`. Un refresh n'écrase jamais un agent de palier modifié : il écrit un fichier `.saasfoundry.new` ; supprimez le fichier pour qu'il soit régénéré |

Tout état autre que `ok` est un `warn` de la précondition `tierAgents`, qui liste les fichiers et donne la remédiation de chaque état. Elle avertit aussi, en disant quoi corriger, quand les agents de
palier ne peuvent pas être comparés du tout : des surcharges de `modules.harness.routing` qui ne se rendent pas, ou un inventaire privé illisible (`routing.tierAgentsIssue` dans `--json`). Elle est
ignorée sur un projet sans harness et quand aucun agent de développement déclaré n'a d'agent de palier.

### Pipeline CI local

Quand le projet déclare un pipeline local dans `.molten/project.json` (MoltenTerm), une ligne `local-ci:` (et un objet `localCi` dans `--json`) le nomme avec son nombre de jobs :
`local-ci: MoltenTerm pipeline (11 jobs)`. L'étape AI testing lance ce pipeline (`molten ci run <branche>`) quand `molten ci status` répond, et la suite npm sinon. `sf status` se contente de lire le
fichier : il n'exécute jamais `molten` ni aucun code du projet, et un fichier endommagé s'affiche `unreadable`, sans faire échouer le statut. La ligne est absente d'un projet qui ne déclare aucun
pipeline.

Un pipeline ne compte que si `ci.jobs` liste au moins un job. Un `.molten/project.json` qui ne contient que le nom et l'icône du projet, ou un `ci.jobs` vide, ne déclare aucun pipeline : la ligne
indique `local-ci: npm suite (.molten/project.json declares no CI job)` (`{ "runner": "npm", "reason": "no-ci-jobs" }` dans `--json`), et l'étape AI testing lance la suite npm.

Avec le workflow GitHub Projects, une ligne `local-ci gate:` (`local-ci-gate:` dans le rapport pour agents, `localCiGate` dans `--json`) indique quels statuts de commit une pull request exige avant la
revue et d'où vient cette liste : `workflow.localCi.requiredStatuses` (`2 statuses from workflow.localCi.requiredStatuses`), les jobs du pipeline Molten
(`11 local-<job> statuses derived from .molten/project.json`), ou le statut que l'agent publie une fois la suite du projet verte (`AI testing / Local CI, published by ai-status…`).
`{ "source": "manifest" | "manifest-none" | "molten" | "agent", "requiredStatuses": [...] }` dans `--json` ; une déclaration illisible s'affiche `unreadable (…)`. `sf workflow set-local-ci` enregistre
la liste.

### Skills personnelles

Claude Code donne à une skill **personnelle** (`~/.claude/skills/<nom>`) la priorité sur une skill de **projet** (`.claude/skills/<nom>`), comme l'indique sa
[documentation des skills](https://code.claude.com/docs/en/skills). Une copie personnelle d'une skill du projet s'exécute donc à la place de celle que le projet versionne, et rien dans la session ne
le dit : un ancien `tool-saasfoundry` personnel gardait son propre `plan-milestone.sh`, et un `tool-github-projects` personnel répondait aux déclencheurs du `sf-tool-github-projects` du projet.
[`sf skill install`](./sf-skill.md#portee-par-defaut) écrivait par défaut dans `~/.claude/skills`, ce qui explique la plupart de ces copies.

La précondition `personalSkills` confronte les skills du dossier personnel à celles du projet (`.claude/skills`, plus les dossiers d'applications d'un multirepo). Chaque constat est un `warn` : la
session démarre quand même, avec des skills que le projet ne maîtrise pas. Elle ne lit que des dossiers et des fichiers : aucun processus, aucun réseau, donc elle répond aussi avec `--no-network`.

| Constat                       | Vérifie                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Même nom                      | Un dossier de `~/.claude/skills` qui porte le nom d'une skill du projet la masque, quel que soit son contenu. Quand les deux dossiers consignent un `.version` (`sf skill install` écrit `{ "cliVersion": … }` ; un simple texte de version est lu aussi), le détail dit si la copie personnelle est la plus ancienne. Une skill sans `.version` lisible est signalée sans affirmation sur son âge |
| Déclencheurs qui se recoupent | Une skill personnelle d'un autre nom qui reprend une expression entre guillemets des déclencheurs de la `description` d'une skill du projet, par exemple un `tool-github-projects` personnel qui cite `"create ticket"` à côté du `sf-tool-github-projects` du projet. Les expressions communes sont listées pour que vous jugiez chacune                                                          |

La remédiation nomme chaque dossier à supprimer, avec la commande : `sf skill uninstall --user` pour la copie `tool-saasfoundry` qu'a écrite `sf skill install`, `rm -r <dossier>` pour les autres. Rien
n'est supprimé à votre place : supprimer une skill personnelle est votre décision, et sortir le dossier de `~/.claude/skills` fonctionne aussi.

La vérification des déclencheurs est volontairement simple et déterministe. Ses limites :

- Elle compare les **expressions entre guillemets doubles** de la `description` du frontmatter (la partie que Claude Code utilise pour choisir une skill), en minuscules et espaces réduits. Les
  expressions de moins de trois caractères sont ignorées. Une seule expression commune suffit à signaler.
- Elle ne voit ni les paraphrases, ni les mots-clés sans guillemets, ni rien du corps de la skill : une skill personnelle qui concurrence sans citer la même expression n'est pas signalée.
- Elle peut signaler une expression générique que deux skills sans rapport citent par hasard. Le rapport liste les expressions, donc un faux positif s'écarte facilement.
- Elle ne regarde que `~/.claude/skills` face au `.claude/skills` du projet : les skills fournies par des plugins ou d'autres agents (`.agents/skills`) ne sont pas comparées.
- Un dossier personnel qui est un lien vers le dossier même du projet est une seule skill, pas un masquage ; il en va de même de tout l'ensemble quand vous lancez `sf status` depuis votre dossier
  personnel.

`--json` renvoie les faits sous `personalSkills` : `{ directory, checked, projectSkills, findings: [{ name, path, shadows?, overlaps }] }`, où `shadows` porte les deux versions et `older` quand elles
se comparent, et `overlaps` liste des `{ projectSkill, phrases }`. La précondition est absente quand il n'y a pas de manifest, et `skip` (jamais un échec) quand les dossiers ne se lisent pas.

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
