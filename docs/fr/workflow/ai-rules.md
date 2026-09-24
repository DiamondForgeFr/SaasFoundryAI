# Règles des agents

Le workflow n'a de valeur que si l'agent respecte ses garde-fous. Ces règles sont contractuelles : une violation est un défaut de comportement, pas une préférence de style.

## 1. Lire le statut configuré avant d'agir

Avant une transition, une branche, une validation ou une pull request, l'agent lit `.saasfoundry.json`, demande le statut réel au CLI et consulte la description installée sous
`.claude/skills/sf-workflow/statuses/`.

Il ne doit pas supposer le preset : le workflow d'équipe a sept statuts, le workflow Solo en a cinq et un workflow personnalisé peut en définir d'autres.

## 2. Ne jamais sauter un statut du workflow actif

Les transitions suivent l'ordre déclaré dans `workflow.statuses`. Dans le preset complet :

```text
Backlog → Ready → In progress → AI testing → Human testing → In review → Done
```

Dans le preset Solo :

```text
Backlog → In progress → AI testing → In review → Done
```

L'absence de `Human testing` dans Solo est un choix du preset, pas un contournement : la revue de PR constitue son point de contrôle humain. À l'inverse, lorsqu'un statut est configuré, l'agent ne le
saute pas.

## 3. Ne jamais contourner le CLI du workflow

Les transitions, sous-tickets et mises à jour du tableau passent par `workflow-cli.sh` puis par l'adaptateur configuré. Aucun appel brut ne doit court-circuiter les contrôles.

Si une opération manque, il faut étendre l'interface plutôt que muter le tableau à côté d'elle.

## 4. Committer et pousser avant AI testing

Le code validé doit exister sur le dépôt distant. Sans cela, les tests ne sont pas reproductibles, la CI et le développeur n'inspectent pas le même état, et le plan de test ne prouve rien.

## 5. Utiliser de vrais sous-tickets natifs

La décomposition utilise des sous-issues natives, pas des cases Markdown. Un enfant normal a sa branche et sa pull request ; un enfant `nature:bundled-pr` apporte un commit atomique à la branche de
livraison du parent.

## 6. Fermer chaque enfant à sa livraison

Un enfant est fermé dès que sa livraison est vérifiée : fusion pour un enfant normal, commit validé dans la livraison du parent pour un enfant groupé. Reporter toutes les fermetures à la fin
désynchronise le code et le tableau.

## 7. Bloquer Done tant que les enfants ne sont pas terminés

Avant `Done`, l'agent vérifie chaque sous-issue native :

```bash
.claude/skills/sf-tool-github-projects/github-projects-cli.sh list-incomplete-children <N>
```

Tout enfant dont le statut de tableau n'est pas exactement `Done` bloque la fin du parent.

## 8. Terminer le ticket actif avant d'en prendre un autre

Un ticket déjà en implémentation, test ou revue est mené jusqu'à sa fin. Seule une demande explicite du développeur autorise une pause. Cette règle évite de mélanger branches, plans de test et
sous-tickets.

## 9. Distinguer les deux validations humaines

Dans le workflow complet :

- **Human testing** = recette fonctionnelle de la fonctionnalité, sur PR brouillon ;
- **In review** = revue de code, sur PR prête avec CI complète.

Dans le workflow Solo, **In review** rassemble la revue de PR et le contrôle humain manuel nécessaire. L'agent doit présenter clairement ce que la personne valide à chaque étape.

## Pourquoi ces règles sont contractuelles

SaaSFoundryAI dogfoode les mêmes règles que ses utilisateurs. Les raccourcis pris dans ce dépôt seraient reproduits dans tous les projets générés. En cas de violation, la bonne réponse est de revenir
au dernier état cohérent et de reprendre la phase, pas de masquer l'écart.
