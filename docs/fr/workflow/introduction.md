# Système de workflow

Le workflow SaaSFoundryAI est un cycle de livraison **piloté par les statuts et adapté à la complexité**, conçu pour la collaboration entre une personne et un agent de développement. Le projet fournit
deux presets prêts à l'emploi et permet aussi de composer son propre workflow.

## Deux presets, selon le contexte

### SaaSFoundry — équipe, 7 statuts

Le preset complet sépare explicitement la validation automatisée, la validation fonctionnelle et la revue de code :

```text
Backlog → Ready → In progress → AI testing → Human testing → In review → Done
```

- **Human testing** désigne la validation fonctionnelle de la fonctionnalité par une personne, sur une pull request en brouillon.
- **In review** désigne la revue de code : la pull request est prête, la CI complète est verte et les commentaires de revue sont traités.

Cette séparation convient aux équipes, aux fonctionnalités exposées aux utilisateurs et aux changements qui demandent une recette explicite avant la revue du code.

### SaaSFoundry Solo — individuel ou interne, 5 statuts

Le preset allégé conserve les protections techniques sans imposer une phase de recette séparée :

```text
Backlog → In progress → AI testing → In review → Done
```

Il n'a ni `Ready` ni `Human testing`. La pull request et sa phase **In review** constituent la validation humaine : le développeur relit le code et teste manuellement si nécessaire avant de fusionner.
Le preset Solo peut ensuite être remplacé en place par le workflow d'équipe.

## Workflows personnalisés

Le mode interactif propose également **Custom Workflow**. Vous pouvez définir des statuts avec leurs noms et leurs descriptions, puis enregistrer et réutiliser le modèle :

```bash
sf workflow create
sf workflow save mon-workflow
sf workflow use mon-workflow
```

Le résultat est enregistré dans `.saasfoundry.json`. Les compétences et les commandes lisent cette configuration ; elles ne doivent jamais supposer qu'un projet utilise forcément cinq ou sept statuts.

## Philosophie

Un Git flow traditionnel concentre l'essentiel des protections au moment de la pull request. Avec un agent sans mémoire durable des décisions précédentes, cela arrive trop tard. SaaSFoundryAI place
donc les garde-fous dans le workflow lui-même : cadrage, plan, implémentation, tests automatisés, validation humaine et revue ont chacun une responsabilité claire.

La pull request n'est pas le premier contrôle. Dans le workflow complet, elle commence en brouillon pour la validation fonctionnelle, puis devient prête pour la revue de code. Dans le workflow Solo,
sa revue est directement le point de contrôle humain.

## Rigueur adaptée à la complexité

Chaque ticket porte l'un des quatre niveaux de complexité. Ce niveau ajuste la profondeur du travail sans modifier arbitrairement le workflow configuré :

| Niveau         | Approche          | Rigueur                                                                |
| -------------- | ----------------- | ---------------------------------------------------------------------- |
| 🐛 **bug**     | Correction ciblée | Analyse et plan allégés, test de régression obligatoire                |
| 🟢 **low**     | Directe           | Exploration minimale, plan mental, pas d'approbation formelle          |
| 🟡 **medium**  | Structurée        | Exploration parallèle, plan détaillé, approbation avant implémentation |
| 🔴 **complex** | Contradictoire    | Analyse approfondie, plan complet, revue sécurité/logique/performance  |

Le niveau de complexité vit sur le ticket, indépendamment de son statut. Consultez le [système de complexité](/fr/workflow/complexity-system) pour le détail.

## Dogfooding

SaaSFoundryAI utilise son propre workflow pour se construire. Le manifeste `.saasfoundry.json` et les compétences `sf-workflow` et `sf-tool-github-projects` de ce dépôt sont les mêmes mécanismes que
ceux déposés dans les projets générés.

Cette contrainte rend le contrat concret : un contournement ou une ambiguïté rencontré ici se propagerait aux projets utilisateurs.

## Source de vérité

Toute la configuration se trouve dans `.saasfoundry.json` :

- `workflow.template` — preset ou modèle choisi ;
- `workflow.statuses` — liste ordonnée des statuts réellement actifs ;
- `workflow.workingBranch` — branche de départ des branches de fonctionnalité ;
- `workflow.prTargetBranch` — cible des pull requests ;
- `workflow.branchNaming.feature` — convention de nommage ;
- `workflow.commitFormat.pattern` — format des commits ;
- `workflow.projectUrl` — tableau utilisé par l'adaptateur.

L'agent lit ces valeurs au lieu de coder en dur des branches, des statuts ou des formats de commit.

## Connexion aux outils

Le moteur délègue les opérations de tableau à un adaptateur. Leur disponibilité en v1 est volontairement explicite :

| Outil               | Portée v1                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------- |
| **GitHub Projects** | Adaptateur de workflow complet : statuts, sous-issues natives, complexité et pull request |
| **Notion**          | Backend SRS complet ; ce n'est pas encore un adaptateur complet de suivi des tickets      |
| **Jira**            | Adaptateur expérimental                                                                   |
| **Linear**          | Adaptateur expérimental                                                                   |

Le point d'entrée `sf-workflow` route les commandes vers l'adaptateur déclaré. GitHub Projects constitue l'intégration de référence pour le cycle v1 complet.

## Étapes suivantes

- [Workflow complet à 7 statuts](/fr/workflow/7-status-system)
- [Système de complexité](/fr/workflow/complexity-system)
- [Règles des agents](/fr/workflow/ai-rules)
- [Intégration GitHub](/fr/workflow/github-integration)
