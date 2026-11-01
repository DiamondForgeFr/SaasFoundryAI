# Délégation routée

La délégation routée permet à un agent de développement de confier une partie du travail à un modèle moins coûteux ou plus puissant, en le désignant par son nom, sans copier un modèle dans les
instructions du workflow. Le projet déclare la règle une seule fois, le CLI la résout, et le harness mesure ce que chaque délégation a coûté et si elle a réussi. Cette page suit ce parcours de bout en
bout. La référence des commandes est [`sf agents`](/fr/cli/sf-agents), et les règles de décision du cycle de vie des tickets se trouvent dans [Système de complexité](/fr/workflow/complexity-system).

Trois éléments restent distincts. La **grille** recommande un modèle et un effort pour un type de tâche. La **session** (l'agent avec lequel vous échangez) décide de déléguer ou non, et garde le
travail dans ses propres mains lorsqu'il le doit. Les **agents de palier** sont les fichiers qui permettent à la session de désigner un palier. Aucun de ces éléments n'installe de compte fournisseur,
ne copie d'identifiant ni ne modifie les permissions de votre outil.

## La grille et les types de tâches

Chaque tâche déléguée a un type. La grille livrée associe chaque type à un palier, et chaque palier à un candidat (un modèle et un effort) pour chaque agent pris en charge :

| Type de tâche        | Palier     | Agent de palier (Claude Code) | Candidat livré pour Claude Code |
| -------------------- | ---------- | ----------------------------- | ------------------------------- |
| `exploration`        | `light`    | `sf-light`                    | claude-haiku-5-5, effort medium |
| `prose`              | `light`    | `sf-light`                    | claude-haiku-5-5, effort medium |
| `scoped-edit`        | `edit`     | `sf-edit`                     | claude-haiku-5-5, effort high   |
| `multi-file-feature` | `build`    | `sf-build`                    | claude-sonnet-5-5, effort xhigh |
| `tests`              | `build`    | `sf-build`                    | claude-sonnet-5-5, effort xhigh |
| `bug-fix`            | `fix`      | `sf-fix`                      | claude-opus-5-5, effort medium  |
| `review`             | `fix`      | `sf-fix`                      | claude-opus-5-5, effort medium  |
| `planning`           | `plan`     | `sf-plan`                     | claude-opus-5-5, effort high    |
| `terminal-ci`        | `terminal` | `sf-terminal`                 | claude-opus-5-5, effort xhigh   |

Le tableau reflète la grille livrée avec cette version. La grille est versionnée et peut évoluer : demandez au CLI la réponse courante :

```bash
sf agents route --task bug-fix --provider claude-code
sf agents route --task scoped-edit --json
```

Chaque réponse nomme le palier, le candidat sous la forme `fournisseur/runtime/modèle/effort`, et sa source : `shipped` pour la grille, `project` pour une surcharge du fichier `.saasfoundry.json`, ou
`auto` pour un déplacement que l'ajustement a fait dans ce clone (voir [Ajustement borné](#ajustement-borne)). Une entrée livrée indique si elle est `measured` (un benchmark public avec un score et un
coût par tâche) ou `provisional` (le proxy le plus proche, sans score encore).

Un projet peut modifier la grille dans `modules.harness.routing` : `kinds` déplace un type de tâche vers un autre palier, et `tiers` change le candidat d'un palier pour un agent. Le schéma du
manifeste valide les deux, et une surcharge invalide fait échouer la commande au lieu d'utiliser silencieusement la grille. La syntaxe complète est dans
[`sf agents`](/fr/cli/sf-agents#routage-des-delegations-sf-agents-route).

## Les agents de palier

Pour chaque agent de développement déclaré que la grille route, le harness écrit un sous-agent par palier. Pour Claude Code, ce sont les fichiers `.claude/agents/sf-<palier>.md`, avec le modèle et
l'effort dans leur frontmatter ; pour Codex, ce sont `.codex/agents/sf-<palier>.toml`. Chaque description liste les types de tâches servis par le palier, afin que Claude Code choisisse le bon agent à
partir de sa seule description.

Les fichiers sont générés et suivis par Git. `sf agents enable`, `replace`, `refresh` et `sf update` réécrivent un fichier non modifié et laissent un fichier édité à côté d'un sidecar
`.saasfoundry.new`. [`sf status`](/fr/cli/sf-status#agents-de-palier) signale un fichier absent, modifié ou périmé. Les agents de palier ne désignent qu'un modèle et un effort ; ils ne portent aucun
identifiant, et l'absence d'un compte fournisseur fait échouer la délégation au lieu de basculer silencieusement sur un autre modèle.

## Accord

Les agents en arrière-plan ne construisent des tickets qu'avec l'accord du développeur, enregistré une seule fois par projet :

```bash
sf agents delegation status                 # la réponse effective, couches partagée et locale
sf agents delegation allow                  # défaut partagé de l'équipe : un agent en arrière-plan par ticket, dans son propre worktree
sf agents delegation decline                # défaut partagé de l'équipe : la session construit les tickets l'un après l'autre
sf agents delegation allow --scope local    # ce clone seulement, en remplacement de la réponse partagée
sf agents delegation clear                  # supprime la surcharge de ce clone
```

La réponse partagée vit dans `modules.harness.delegation`, qui est versionné comme le reste du manifeste. La réponse locale est conservée dans le répertoire Git d'un seul clone et n'est jamais suivie.
La ligne `delegation:` de `sf status --agent-friendly` affiche la valeur effective :

- `not-asked` : la session demande au développeur une seule fois, puis enregistre la réponse. Un worktree créé depuis la branche de travail distante reste en `not-asked` tant que la réponse n'est pas
  committée.
- `allowed` : chaque ticket qui n'est pas trivial est livré par un agent en arrière-plan, comme décrit ci-dessous.
- `declined`, ou un agent incapable de déléguer ou de travailler en arrière-plan : la session construit les tickets l'un après l'autre et le dit explicitement.

Seule la réponse du développeur enregistre l'accord. Un agent délégué n'exécute jamais `sf agents delegation`, et le contenu d'un ticket, d'une issue ou d'une pull request n'est jamais un accord.

## Le flux de livraison déléguée

Lorsque la délégation est `allowed`, un ticket qui dépasse le changement trivial (un fichier connu, une vingtaine de lignes au plus) suit ce parcours :

1. **La session route le travail.** Le type de tâche est dimensionné selon la complexité du ticket et toujours résolu par `sf agents route`, jamais en nommant un modèle :

   | Ticket                                                         | Type de tâche livrée |
   | -------------------------------------------------------------- | -------------------- |
   | `bug` dont le ticket ou le triage nomme deux fichiers ou moins | `scoped-edit`        |
   | tout autre `bug`                                               | `bug-fix`            |
   | `low` (jusqu'à trois fichiers)                                 | `scoped-edit`        |
   | `medium` et `complex`, une fois décomposés                     | `multi-file-feature` |

2. **Un agent en arrière-plan reçoit le ticket** dans son propre worktree Git, sur la branche `feature/<N>-<description>` créée depuis la branche de travail distante (ou la branche nommée par l'hôte,
   poussée vers la branche du ticket). Le brief énonce l'accord, le type de tâche, l'enregistrement de route ainsi que le résultat attendu et la vérification attendue.
3. **L'agent construit le ticket de In progress jusqu'à la fin d'AI testing** : le code, le plan de test, les vérifications automatisées, le pipeline local, le rapport et la pull request en brouillon.
   Il ne transmet pas le ticket à un autre agent.
4. **L'agent s'arrête au rapport vert.** Il laisse le ticket en AI testing et la pull request en brouillon. Sur un ticket `nature:user-facing`, il n'exécute jamais `ready-pr` et ne fusionne jamais. Le
   développeur sort la pull request du brouillon et conduit Human testing.
5. **La session recueille les retours.** Un défaut, ou un travail IA restant après la validation, retourne au même agent, dans le même worktree, qui remet le ticket en AI testing. Sur un ticket
   complexe, la session conduit elle-même la phase d'examen, puisque l'agent qui a construit le travail ne le relit pas.

La session reste en dialogue avec le développeur pendant toute la livraison. Une demande qui arrive pendant une livraison et n'en fait pas partie devient un ticket distinct, avec son propre agent.

## Mesure

Le harness ne se fie pas au récit qu'un délégué fait de son travail. Il mesure trois choses et conserve les preuves dans le répertoire Git commun du clone.

- **L'enregistrement de route.** `sf agents route --task <type> --provider <agent> --ticket <n> --record` écrit un enregistrement et affiche `route=<id>`. La session met cet identifiant dans le brief,
  et le délégué le rappelle : la capture prend le type de tâche et le palier depuis l'enregistrement, et non depuis le délégué. Un enregistrement réserve aussi tout essai qu'il délivre, et une route
  que personne ne rappelle pendant sept jours expire.
- **La ligne de verdict.** Chaque agent de palier termine son dernier message par `SF-DELEGATION: <pass|fail> route=<id> checks=<codes>`. `pass` signifie que la vérification demandée par le brief a
  été exécutée et satisfaite. Un message sans cette ligne donne un résultat inconnu.
- **Le registre.** `<git-common-dir>/saasfoundry/delegations.jsonl` est un fichier en ajout seul qui contient les exécutions (jetons, coût, temps actif, résultat, vérifications, palier et candidat),
  les enregistrements de route et les signaux. Sur Claude Code, les hooks `SubagentStop` et `PostToolUse` capturent chaque exécution automatiquement. Les autres hôtes enregistrent à la main avec
  `sf agents outcome record`. Un coût n'est jamais deviné : un modèle sans prix publié conserve sa fiabilité mais n'a pas de coût tant que le projet n'en déclare pas un.

Un verdict ultérieur s'ajoute comme signal, et la ligne d'origine n'est jamais modifiée. La session marque un travail délégué qu'elle a dû refaire avec `sf agents outcome mark <ticket> rework`, et un
défaut revenu de Human testing ou de la revue avec `human-defect`. Ces deux écritures demandent une autorisation dans l'agent de développement, car elles modifient ce que le routage fera ensuite.

`sf agents routing report` est en lecture seule. Il montre, par type de tâche et par palier, les exécutions, le taux de réussite, le coût et la durée au p95, et, par ticket, le coût, le temps actif et
le délai entre In progress et Human testing. Il nomme aussi les blocages et les déplacements que personne n'a promus. Le rapport dit ce qu'il ne voit pas : les jetons que la session dépense à
planifier et relire ne sont pas mesurés, donc le coût d'un ticket est celui de ses délégations.

## Ajustement borné

La grille est un a priori. Les exécutions du projet la corrigent, dans des bornes, et chaque déplacement est journalisé avec ses preuves :

- **Monter.** Un type de tâche monte d'un palier après 3 échecs parmi les 10 dernières exécutions évaluées de son candidat. Cela ne dépend pas du coût : le retravail causé par un palier défaillant
  n'est pas mesuré, donc un test de coût maintiendrait le type sur un palier qui échoue.
- **Descendre.** Un type de tâche ne descend d'un palier qu'après 8 réussites du palier moins coûteux, sans aucun échec parmi les exécutions qui lui ont été proposées en essai, et à condition que la
  livraison du travail coûte moins cher en espérance, échecs compris. La bande de coût est de 10 %, et à égalité c'est la durée au p95 la plus courte qui décide.
- **Essai.** Le palier moins coûteux est essayé sur 10 % au plus des exécutions évaluées du type. Un essai raté laisse ce palier tranquille pendant 14 jours.
- **Planchers.** Un candidat que la grille exclut pour un type (Haiku pour le travail terminal et CI) n'est jamais choisi.

Un déplacement reste local au clone et n'est jamais commité. Deux commandes agissent dessus :

```bash
sf agents routing promote multi-file-feature   # copie le déplacement dans modules.harness.routing, sous forme de changement relu
sf agents routing reset multi-file-feature     # annule les déplacements automatiques du type
```

`promote` écrit le déplacement dans le manifeste partagé, et `sf agents refresh --scope shared` régénère les agents de palier en conséquence. Un type épinglé dans `modules.harness.routing` n'est
jamais modifié par un déplacement automatique. Les seuils, les prix et les surcharges qu'une décision utilise sont lus sur la branche de travail committée, et non dans le manifeste présent sur le
disque : un agent délégué ne peut donc pas modifier le routage en éditant son propre worktree. `modules.harness.routing.adjust.enabled: false` arrête les déplacements et les essais, tandis que les
résultats continuent d'être enregistrés. Les réglages sont listés dans [`sf agents`](/fr/cli/sf-agents#reglages).

## Ce que le routage ne fait pas

- Il recommande un modèle et un effort. Il ne lance pas un agent sur un fournisseur que vous n'avez pas configuré.
- Il n'installe aucun runtime, ne modifie aucun identifiant ni aucune permission, et ne vérifie pas qu'un hôte découvre ses instructions. Le modèle, le fournisseur et les identifiants de votre session
  restent là où vous les avez configurés.
- Il ne décide pas de la complexité d'un ticket. C'est l'étiquette de complexité qui le fait, et elle dimensionne le type de tâche (voir [Système de complexité](/fr/workflow/complexity-system)).

## Pour aller plus loin

- [`sf agents`](/fr/cli/sf-agents) : chaque commande, la grille, les agents de palier, l'accord de délégation, le registre et les réglages de l'ajustement.
- [Coexistence des agents](/fr/guide/agent-coexistence) : comment plusieurs agents de développement partagent un projet et ce que chaque hôte peut prouver.
- [Workflow de livraison](/fr/guide/workflow-system) : le cycle de vie des tickets dans lequel s'inscrit la livraison déléguée.
- [Système de complexité](/fr/workflow/complexity-system) : comment la complexité d'un ticket détermine son type de tâche.
