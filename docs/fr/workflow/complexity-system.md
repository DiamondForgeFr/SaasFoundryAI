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

| Étape        | Comportement                                                                                          |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| Analyse      | Ciblée directement sur la cause                                                                       |
| Plan         | Pas de document formel                                                                                |
| Sous-tickets | Inutiles pour une correction atomique                                                                 |
| Exécution    | Livraison déléguée en `bug-fix`, ou en `scoped-edit` quand le ticket nomme déjà deux fichiers au plus |
| Examen       | Pas de revue contradictoire systématique                                                              |
| Tests        | **Test de régression obligatoire**                                                                    |

### 🟢 Low

| Étape        | Comportement                                      |
| ------------ | ------------------------------------------------- |
| Analyse      | Minimale, 2 à 3 fichiers, sans agents spécialisés |
| Plan         | Mental, sans approbation formelle                 |
| Sous-tickets | Optionnels ; utiles si le périmètre s'élargit     |
| Exécution    | Livraison déléguée en `scoped-edit`               |
| Examen       | Non requis                                        |
| Tests        | Adaptés au risque ; toute omission est annoncée   |

### 🟡 Medium

| Étape        | Comportement                                                 |
| ------------ | ------------------------------------------------------------ |
| Analyse      | Exploration structurée de plusieurs zones                    |
| Plan         | Détaillé fichier par fichier, **approbation obligatoire**    |
| Sous-tickets | **Obligatoires** pour les unités de livraison majeures       |
| Exécution    | Livraison déléguée en `multi-file-feature` une fois découpée |
| Examen       | Pas de revue contradictoire complète                         |
| Tests        | Unitaires, E2E et régression recommandés selon le changement |

Les explorateurs restent en lecture seule. Des implémentations parallèles n'utilisent des worktrees distincts que si leurs responsabilités et fichiers sont réellement indépendants.

Chaque délégation nomme un type de tâche (`exploration` pour l'analyse, `review` pour la revue contradictoire) que l'agent résout avec
[`sf agents route`](../cli/sf-agents.md#routage-des-delegations-sf-agents-route) pour choisir l'agent de palier. La section « Delegation routing » du skill workflow porte la règle.

### 🔴 Complex

| Étape        | Comportement                                                        |
| ------------ | ------------------------------------------------------------------- |
| Analyse      | Approfondie et multi-angle                                          |
| Plan         | Complet, dépendances explicites, **approbation obligatoire**        |
| Sous-tickets | **Obligatoires et granulaires**                                     |
| Exécution    | Livraison déléguée en `multi-file-feature` une fois découpée        |
| Examen       | **Revue contradictoire** sécurité, logique et performance           |
| Tests        | **Obligatoires** : unitaires, E2E, régression et couverture adaptée |

### Livraison déléguée

Lorsque le développeur l'a permis (`sf agents delegation allow`, voir [Livraison déléguée des tickets](../cli/sf-agents.md#livraison-deleguee-des-tickets-sf-agents-delegation)), la session ne
construit pas le ticket : elle le confie, de In progress à la fin d'AI testing, à un agent en arrière-plan dans son propre worktree. Le type de tâche de cette livraison est dimensionné selon le
travail, si bien qu'un petit ticket ne tourne pas sur le modèle de la session. Chaque profil le déclare dans `steps.execute.taskKind`, et l'agent le résout avec `sf agents route` :

| Ticket                                                                             | Type de tâche de la livraison                                              |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 🐛 Bug dont le ticket ou le tri nomme déjà les fichiers à changer (deux au plus)   | `scoped-edit` (`steps.execute.scopedTaskKind`)                             |
| 🐛 Tout autre bug : les fichiers ne sont connus qu'après le diagnostic             | `bug-fix`                                                                  |
| 🟢 Low (il peut toucher jusqu'à trois fichiers ; la livraison reste `scoped-edit`) | `scoped-edit`                                                              |
| 🟡 Medium, 🔴 Complex                                                              | `multi-file-feature`, une fois découpé (la planification reste en session) |

Un bug ne peut pas nommer ses fichiers avant d'être diagnostiqué : il prend `bug-fix` par défaut. Un changement trivial reste dans la session : un seul fichier connu, environ 20 lignes au plus (une
coquille, une valeur de configuration, une ligne de documentation), qui ne justifie ni un worktree ni une installation de dépendances.

L'agent délégué s'arrête au commentaire `## Test report` vert, avec la pull request en brouillon. Sur un ticket complexe, la session mène elle-même la revue contradictoire.

## Revue contradictoire

Après les validations, trois regards indépendants examinent un ticket complexe :

- **sécurité** — OWASP, validation des entrées, autorisations et injections ;
- **logique** — cas limites, courses, erreurs de borne et invariants ;
- **performance** — N+1, boucles non bornées, mémoire et chemins coûteux.

Les constats sont classés par sévérité et confiance. Les constats critiques et élevés sont corrigés avant la validation humaine. Les reviewers sont en lecture seule ; l'auteur coordonne les
corrections.

## Principe de préservation de la qualité

Le système ne sert pas à rogner la qualité des petits tickets. Il évite une cérémonie disproportionnée tout en conservant toute la rigueur nécessaire aux changements risqués. Cette adaptation
fonctionne avec les presets protégés Team et Solo ; une extension Custom doit d'abord fournir ses propres documents et garde-fous de statut.

## Fichiers de configuration

Chaque niveau possède un fichier YAML :

- `.claude/skills/sf-workflow/complexity/bug.yml` ;
- `.claude/skills/sf-workflow/complexity/low.yml` ;
- `.claude/skills/sf-workflow/complexity/medium.yml` ;
- `.claude/skills/sf-workflow/complexity/complex.yml`.

Ces fichiers déclarent les étapes activées, les attentes de test et les instructions narratives données à l'agent. Ils permettent à l'équipe d'ajuster la cérémonie sans changer de skill.

## Changer de niveau en cours de route

Si l'exploration révèle un risque différent — par exemple une contrainte de sécurité imprévue — changez le label :

```bash
.claude/skills/sf-workflow/workflow-cli.sh retag 42 complex
```

Les étapes restantes s'adaptent au nouveau niveau. Une revue contradictoire devenue obligatoire est ajoutée au plan de validation restant.
