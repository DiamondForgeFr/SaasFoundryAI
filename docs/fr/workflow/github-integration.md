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

# Après validation fonctionnelle : PR prête et revue de code
$CLI ready-pr 42
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
