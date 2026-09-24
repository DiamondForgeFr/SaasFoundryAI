# Système de complexité

Tous les changements ne justifient pas la même cérémonie. Une coquille ne demande pas une revue de sécurité contradictoire ; une modification d'authentification ne doit pas partir sans elle.
SaaSFoundryAI adapte donc la profondeur du travail au risque réel du ticket.

## Les quatre niveaux

| Niveau         | Label   | Approche           | Cas typique                                                              |
| -------------- | ------- | ------------------ | ------------------------------------------------------------------------ |
| 🐛 **bug**     | Bug fix | Correction directe | Défaut connu, correction localisée, test de régression                   |
| 🟢 **low**     | Low     | Directe            | Coquille, documentation, petit refactoring, 1 à 3 fichiers               |
| 🟡 **medium**  | Medium  | Structurée         | Fonctionnalité standard, plusieurs fichiers, périmètre clair             |
| 🔴 **complex** | Complex | Contradictoire     | Authentification, paiement, sécurité, concurrence, changement transverse |

Plus la complexité est élevée, plus l'analyse, le plan, la revue contradictoire et les tests sont approfondis.

## Détection et décision

La complexité est un label du ticket (`complexity: bug|low|medium|complex`), indépendant du statut sur le tableau. L'agent lance :

```bash
.claude/skills/sf-workflow/scripts/detect-complexity.sh <ticket>
```

La détection prend en compte le nombre de fichiers, les mots-clés sensibles, les modules touchés et les tickets comparables. **Le développeur garde le dernier mot.** Un niveau peut être corrigé à tout
moment :

```bash
.claude/skills/sf-workflow/workflow-cli.sh retag <ticket> <nouveau-niveau>
```

## Comportement par niveau

### 🐛 Bug

| Étape        | Comportement                             |
| ------------ | ---------------------------------------- |
| Analyse      | Ciblée directement sur la cause          |
| Plan         | Pas de document formel                   |
| Sous-tickets | Inutiles pour une correction atomique    |
| Examen       | Pas de revue contradictoire systématique |
| Tests        | **Test de régression obligatoire**       |

### 🟢 Low

| Étape        | Comportement                                      |
| ------------ | ------------------------------------------------- |
| Analyse      | Minimale, 2 à 3 fichiers, sans agents spécialisés |
| Plan         | Mental, sans approbation formelle                 |
| Sous-tickets | Optionnels ; utiles si le périmètre s'élargit     |
| Examen       | Non requis                                        |
| Tests        | Adaptés au risque ; toute omission est annoncée   |

### 🟡 Medium

| Étape        | Comportement                                                 |
| ------------ | ------------------------------------------------------------ |
| Analyse      | Exploration structurée de plusieurs zones                    |
| Plan         | Détaillé fichier par fichier, **approbation obligatoire**    |
| Sous-tickets | **Obligatoires** pour les unités de livraison majeures       |
| Examen       | Pas de revue contradictoire complète                         |
| Tests        | Unitaires, E2E et régression recommandés selon le changement |

Les explorateurs restent en lecture seule. Des implémentations parallèles n'utilisent des worktrees distincts que si leurs responsabilités et fichiers sont réellement indépendants.

### 🔴 Complex

| Étape        | Comportement                                                        |
| ------------ | ------------------------------------------------------------------- |
| Analyse      | Approfondie et multi-angle                                          |
| Plan         | Complet, dépendances explicites, **approbation obligatoire**        |
| Sous-tickets | **Obligatoires et granulaires**                                     |
| Examen       | **Revue contradictoire** sécurité, logique et performance           |
| Tests        | **Obligatoires** : unitaires, E2E, régression et couverture adaptée |

## Revue contradictoire

Après les validations, trois regards indépendants examinent un ticket complexe :

- **sécurité** — OWASP, validation des entrées, autorisations et injections ;
- **logique** — cas limites, courses, erreurs de borne et invariants ;
- **performance** — N+1, boucles non bornées, mémoire et chemins coûteux.

Les constats sont classés par sévérité et confiance. Les constats critiques et élevés sont corrigés avant la validation humaine. Les reviewers sont en lecture seule ; l'auteur coordonne les
corrections.

## Principe de préservation de la qualité

Le système ne sert pas à rogner la qualité des petits tickets. Il évite une cérémonie disproportionnée tout en conservant toute la rigueur nécessaire aux changements risqués. Cette adaptation
fonctionne avec le preset d'équipe, le preset Solo et les workflows personnalisés.

Les définitions se trouvent dans `.claude/skills/sf-workflow/complexity/*.yml`. Elles règlent les étapes, les attentes de test et les instructions données à l'agent.
