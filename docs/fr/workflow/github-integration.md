# Intégration GitHub Projects

La compétence `sf-tool-github-projects` est l'adaptateur de référence du workflow SaaSFoundryAI v1. Elle relie les statuts, la complexité et les sous-issues natives à GitHub Projects V2 et GitHub
Issues.

GitHub Projects est le seul adaptateur qui couvre aujourd'hui tout le workflow v1. Jira et Linear restent expérimentaux. Notion fournit un backend SRS complet, mais pas encore un adaptateur complet de
suivi des tickets.

## Modèle de données

Deux axes indépendants structurent un ticket :

| Axe            | Emplacement                                          | Responsabilité                                   |
| -------------- | ---------------------------------------------------- | ------------------------------------------------ |
| **Statut**     | Champ à choix unique `Status` de Projects V2         | Phase du workflow configuré                      |
| **Complexité** | Label GitHub `complexity: bug\|low\|medium\|complex` | Profondeur de l'analyse, des tests et des revues |

Un statut n'est pas un label et la complexité n'est pas une colonne de phase. Leur indépendance permet de requalifier le risque sans déplacer le ticket.

## Prérequis

- Un tableau GitHub Projects V2 dont le champ `Status` contient les statuts du preset choisi.
- Les quatre labels de complexité.
- `gh` authentifié avec les droits `project` et `repo`.
- `.saasfoundry.json` configuré avec l'URL du tableau et les branches.

Le preset d'équipe attend sept statuts et Solo en attend cinq ; tous deux possèdent des garde-fous complets. Un modèle personnalisé peut aligner le board avec les statuts du manifeste, mais son
parcours exige des documents et garde-fous écrits par l'équipe avant utilisation.

## Commandes de l'adaptateur

Toutes les interactions passent par `.claude/skills/sf-tool-github-projects/github-projects-cli.sh` :

| Commande                                  | Rôle                                                              |
| ----------------------------------------- | ----------------------------------------------------------------- |
| `create-subtask <parent> <titre> [corps]` | Créer une sous-issue et établir sa relation native avec le parent |
| `status <ticket>`                         | Lire le statut Projects V2                                        |
| `update-status <ticket> <statut>`         | Modifier le statut selon les options du tableau                   |
| `set-complexity <ticket> <niveau>`        | Remplacer le label de complexité                                  |
| `get-complexity <ticket>`                 | Lire le niveau actuel                                             |
| `get-ticket <ticket>`                     | Lire le titre et le corps                                         |
| `create-pr <ticket> --draft`              | Ouvrir ou réutiliser la PR brouillon de validation fonctionnelle  |
| `draft-pr <ticket>`                       | Remettre en brouillon une PR prête pour un nouveau test           |
| `create-pr <ticket>`                      | Créer ou préparer la PR pour la revue de code                     |
| `list-incomplete-children <ticket>`       | Lister les enfants qui ne sont pas `Done`                         |

Les noms de statut sont résolus à partir du tableau et du manifeste ; ils ne doivent pas être codés en dur dans l'orchestration.

### Commandes PR sur une branche nommée par l'hôte

`create-pr`, `ready-pr` et `draft-pr` travaillent sur la branche du ticket : celle que `workflow.branchNaming` donne pour ce ticket (`feature/{N}-…` ou `fix/{N}-…`, ou la convention de release pour un
ticket de release). C'est la branche courante dès qu'elle respecte la convention, et rien ne change alors.

Un agent délégué lancé avec `isolation: "worktree"` de Claude Code est sur une branche que l'hôte a nommée, `worktree-agent-<id>`, et y pousse son travail vers la branche du ticket :

```bash
git push origin HEAD:feature/42-add-export
.claude/skills/sf-workflow/workflow-cli.sh create-pr 42 --draft
```

Les commandes acceptent ce checkout quand **origin porte la branche du ticket sur le commit du `HEAD` local** : le travail est poussé en entier, et la pull request contient exactement ce qui est
extrait.

- **Sans `--head`**, la CLI cherche sur origin les branches feature ou fix du ticket qui pointent sur `HEAD`. Une seule est utilisée, et la commande affiche une ligne qui dit laquelle. Aucune, ou
  plusieurs, est refusée par une erreur qui nomme `--head`. Les branches de release ne sont jamais cherchées : elles ne portent pas de numéro de ticket.
- **Avec `--head <branche>`**, la branche est celle qui est nommée. Elle doit respecter le `branchNaming` du ticket (une branche de release est permise là où la commande permet une pull request de
  release), et origin doit la porter sur `HEAD`. C'est la sortie quand plusieurs branches sont sur `HEAD`.

Tout le reste est refusé, et le message dit pourquoi : une branche absente d'origin, une branche poussée mais en retard sur `HEAD` (pousser de nouveau : `git push origin HEAD:<branche>`), et la
branche d'un autre ticket, même sur `HEAD`. Une pull request n'est jamais promue depuis une branche qui n'est pas prouvée être le travail extrait, donc la branche d'un autre développeur ne peut pas
être prise par erreur.

À partir de là, la branche est celle du ticket. `create-pr` ne pousse rien, puisqu'origin la porte déjà, et ouvre la pull request depuis cette branche (`gh pr create --head`). Le rattachement au
tableau, la ligne `Resolves #<ticket>`, la branche de base et les garde-fous sont ceux de n'importe quelle branche de ticket.

## Routage depuis `sf-workflow`

`workflow-cli.sh` est le point d'entrée indépendant de l'outil :

```bash
.claude/skills/sf-workflow/workflow-cli.sh status 42
.claude/skills/sf-workflow/workflow-cli.sh retag 42 complex
.claude/skills/sf-workflow/workflow-cli.sh create-subtask 42 "API backend"
```

Il lit `workflow.tool` et route la commande vers l'adaptateur GitHub configuré, avec ses contrôles de transition.

## Cycle d'équipe complet

```bash
CLI=.claude/skills/sf-workflow/workflow-cli.sh

# Cadrage
$CLI retag 42 medium
$CLI update-status 42 "Ready"

# Implémentation
$CLI update-status 42 "In progress"
$CLI create-subtask 42 "API backend"
git commit -m "feat(#SUB-1): add backend API" && git push
$CLI update-status <SUB-1> "Done"

# Validation automatisée
$CLI update-status 42 "AI testing"
npm run test:pre-push

# Validation fonctionnelle sur PR brouillon
$CLI create-pr 42 --draft
$CLI update-status 42 "Human testing"

# Après validation fonctionnelle : le développeur clique sur Ready for review (ready-pr n'est à l'agent que sans Human testing)
$CLI update-status 42 "In review"

# Après approbation, CI verte et fusion
$CLI list-incomplete-children 42
$CLI update-status 42 "Done"
```

## Cycle Solo

Le preset Solo retire `Ready` et `Human testing` :

```text
Backlog → In progress → AI testing → In review → Done
```

Après les tests automatisés, la pull request en `In review` est le contrôle humain. Le développeur relit, teste manuellement si le changement le justifie, puis fusionne. Les protections de push, de
CI, de revue et de fusion restent actives.

## Sous-issues natives

`create-subtask` crée l'issue puis établit la relation native `addSubIssue`. Cette relation est indispensable au roll-up des Epics et au blocage de `Done`. Un préfixe de titre, une mention dans le
corps ou une case Markdown ne la remplace pas.

`list-incomplete-children` parcourt cette relation et vérifie le statut Projects V2 de chaque enfant ; l'état ouvert/fermé de l'issue ne suffit pas.

## Quand une opération échoue

- **Transition impossible** : comparer les statuts du tableau à `workflow.statuses`.
- **Enfant absent du contrôle** : vérifier la relation native ; recréer via `create-subtask` plutôt qu'avec une commande brute.
- **Complexité incohérente** : utiliser `get-complexity`, puis `set-complexity`.
- **PR impossible** : vérifier `workflow.prTargetBranch`, la branche distante et la convention qui inclut le numéro du ticket.
- **Human testing confondu avec la revue** : la PR reste brouillon pendant la validation fonctionnelle et devient prête seulement pour `In review`.

## Autres outils

Le contrat d'adaptateur permet d'autres intégrations, mais leur maturité doit rester visible : GitHub Projects couvre le workflow v1 ; Jira et Linear sont expérimentaux ; Notion couvre la SRS v1 sans
constituer un tracker complet. N'annoncez pas une parité qui n'existe pas encore.
