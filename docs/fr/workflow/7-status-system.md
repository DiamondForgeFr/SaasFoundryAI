# Workflow complet à 7 statuts

Le preset **SaaSFoundry** fait passer chaque ticket de livraison par sept statuts. Chaque statut impose des actions et des conditions de sortie. L'agent lit la description correspondante dans
`.claude/skills/sf-workflow/statuses/` avant d'agir.

::: tip Deux workflows natifs

Cette page décrit le preset d'équipe complet. Le preset **SaaSFoundry Solo** utilise cinq statuts (`Backlog → In progress → AI testing → In review → Done`) : il retire `Ready` et la phase séparée
`Human testing`. Des workflows personnalisés peuvent aussi être créés avec `sf workflow create`.

:::

## Vue d'ensemble

| #   | Statut            | Rôle                                                                   |
| --- | ----------------- | ---------------------------------------------------------------------- |
| 1   | **Backlog**       | Cadrage : complexité, analyse, plan et validation                      |
| 2   | **Ready**         | File de tickets validés et prêts à être pris                           |
| 3   | **In progress**   | Implémentation active, sous-tickets et commits                         |
| 4   | **AI testing**    | Validations automatisées et exécution du plan de test                  |
| 5   | **Human testing** | **Validation fonctionnelle** de la fonctionnalité sur une PR brouillon |
| 6   | **In review**     | **Revue de code** sur une PR prête, avec CI complète                   |
| 7   | **Done**          | Fusion vérifiée et nettoyage                                           |

Un `sf-epic` agrège des livraisons : il ne possède ni branche ni pull request. Il reste `In progress` pendant la livraison de ses enfants et n'atteint `Done` que lorsque tous ses enfants natifs sont
eux-mêmes `Done`.

## 1. Backlog

**Entrée :** une idée, une demande de fonctionnalité ou un défaut est créé.

**Actions obligatoires :**

1. Lire complètement le ticket.
2. Détecter la complexité 🐛 / 🟢 / 🟡 / 🔴 ; le développeur tranche.
3. Analyser avec une profondeur adaptée au niveau.
4. Produire un plan adapté. Les plans medium et complex exigent une approbation explicite.
5. Challenger les spécifications, les cas limites et l'approche technique.
6. Vérifier problème, critères d'acceptation, contexte technique et label de complexité.

**Sortie :** complexité définie, analyse et plan requis terminés, spécifications validées. Aucune branche ni implémentation ne commence ici.

## 2. Ready

**Entrée :** le ticket est validé et priorisé.

L'agent attend que le développeur lui attribue explicitement le ticket. `Ready` est une file d'attente, pas une phase de travail. Ce statut n'existe pas dans le preset Solo.

## 3. In progress

**Actions obligatoires :**

1. Lire `.saasfoundry.json`, notamment la branche de travail et la convention de nommage.
2. Créer la branche de fonctionnalité depuis la branche configurée.
3. Déplacer le ticket vers `In progress` avec le CLI du workflow.
4. Décomposer si nécessaire en sous-issues GitHub natives, jamais en simples cases Markdown.
5. Implémenter par incréments. Un enfant normal possède sa branche et sa PR ; un enfant `nature:bundled-pr` devient un commit atomique sur la branche du parent.
6. Fermer chaque enfant dès que sa livraison est vérifiée.
7. Committer et pousser avant de demander `AI testing`.

**Sortie :** implémentation poussée, commits distants et code prêt à valider.

## 4. AI testing

**Actions obligatoires :**

1. Publier le plan de test : prérequis, scénarios, résultats attendus et non-régression.
2. Exécuter build, lint, vérification des types, tests unitaires et la voie de validation prévue par le dépôt.
3. Exécuter manuellement chaque scénario du plan et documenter le résultat.
4. En cas de défaut : corriger, committer, pousser et recommencer la validation.

**Sortie :** contrôles verts, scénarios validés et aucun blocage ouvert.

## 5. Human testing — validation fonctionnelle

Cette phase est une **recette de la fonctionnalité**, pas une revue de code. Le workflow ouvre une pull request en **brouillon** afin que le développeur puisse inspecter et tester un état distant
stable.

1. Le développeur teste les parcours et confirme que la fonctionnalité répond au besoin.
2. Si un défaut est trouvé, l'agent explique la correction, l'implémente, pousse puis retourne en `AI testing`.
3. Après validation, les tests de non-régression nécessaires sont ajoutés et vérifiés.

Les tickets `nature:internal` peuvent ne pas exiger cette phase selon les règles configurées. Le preset Solo n'a pas de statut `Human testing` distinct : sa validation humaine a lieu pendant
`In review`.

## 6. In review — revue de code

Cette phase est la **revue du code et de la qualité d'intégration**. La pull request quitte le mode brouillon et devient prête à relire.

1. Vérifier que la PR lie le ticket, résume le plan de test et les tests ajoutés.
2. Demander les reviewers requis.
3. Surveiller la CI complète et corriger toute régression.
4. Répondre aux commentaires de revue, modifier le code et compléter les tests si nécessaire.
5. Attendre les approbations et une CI verte.

**Sortie :** revue approuvée et CI entièrement verte.

## 7. Done

**Entrée :** la pull request est fusionnée par le développeur, ou un enfant `nature:bundled-pr` a été validé dans la livraison de son parent.

1. Vérifier la fusion et que tous les enfants natifs sont `Done`.
2. Déplacer le ticket vers `Done` avec le CLI.
3. Synchroniser la branche de travail configurée et nettoyer uniquement les branches locales fusionnées qui ne sont plus utilisées.

## Pourquoi ces portes comptent

- `Backlog → Ready` bloque les spécifications ambiguës.
- `AI testing` évite de déléguer à une personne les défauts détectables automatiquement.
- `Human testing` prouve la valeur fonctionnelle avant la revue de code.
- `In review` contrôle la qualité du code, la CI et le regard d'un pair.
- `Done` exige une fusion réelle et des enfants terminés.

Le preset Solo réduit le nombre de colonnes, pas l'exigence de validation : sa PR en revue concentre le contrôle humain. Consultez les [règles des agents](/fr/workflow/ai-rules).
