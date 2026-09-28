# Système de skills

Les skills constituent la couche opérationnelle du harness de développement. Chaque `SKILL.md` explique quand une capacité s’applique, quels faits du projet lire, quel script protégé utiliser et où
l’approbation humaine reste obligatoire.

Ils ne remplacent pas le CLI. Un skill apporte à l’agent de développement le contexte et la procédure ; le CLI exécute les opérations déterministes et vérifie les préconditions.

## Le contrat `sf-*`

SaaSFoundryAI réserve le préfixe `sf-` aux comportements appartenant au projet :

- `sf-workflow` — routage des statuts, complexité et garde-fous de livraison ;
- `sf-integration-rules` — grammaire de raccordement du backend au frontend ;
- `sf-git-commit` et `sf-git-create-pr` — opérations Git conscientes du dépôt ;
- `sf-srs` — cycle de vie des spécifications ;
- `sf-tool-*` — adaptateurs pour les boards, la documentation, le design et le contexte technique.

Lorsqu’un skill global générique recouvre un skill projet `sf-*`, le skill du projet est prioritaire. Cette règle empêche un assistant installé globalement d’ignorer `.saasfoundry.json` ou de
contourner les barrières de revue du projet.

## Source gérée et copies portables

Pendant la phase de compatibilité multi-agent additive, la source gérée reste sous `.claude/skills/`. SaaSFoundryAI peut aussi créer des copies partagées et révisables sous `.agents/skills/` pour les
profils non-Claude déclarés :

```text
.claude/skills/           source gérée et scripts protégés
.agents/skills/           copies partagées portables
CLAUDE.md                 point d’entrée Claude Code
AGENTS.md                 point d’entrée portable/Codex
GEMINI.md                 point d’entrée Gemini CLI si sélectionné
```

Ne déduisez jamais la prise en charge d’un runtime du nom d’un dossier. `sf agents doctor` vérifie les fichiers et les capacités documentées, mais seule une observation native dans l’hôte réel peut
prouver la découverte, les hooks, les permissions ou l’accès au modèle.

## Topologie d’installation

- **Monorepo :** le harness peut être partagé depuis la racine du workspace ; API, Web et packages lisent un seul contrat.
- **Multirepo :** chaque dépôt reçoit les fichiers nécessaires du harness pour rester opérationnel lorsqu’il est cloné seul.

Le manifeste enregistre la topologie et les bases gérées. `sf update` utilise ces références pour distinguer les évolutions amont des personnalisations de l’utilisateur.

## Fonctionnement de l’invocation

L’invocation dépend de l’hôte :

- Claude Code peut découvrir la surface historique `.claude/skills` et ses conventions de commandes ;
- Codex et les autres profils déclarés suivent leurs instructions natives de projet et les procédures partagées dans `.agents/skills` ;
- un hôte générique peut demander à l’utilisateur ou à l’agent d’ouvrir explicitement `SKILL.md`.

L’invariant portable est la procédure, pas une syntaxe particulière de commande. Un agent capable doit :

1. lire son point d’entrée d’instructions ;
2. inspecter `.saasfoundry.json` ;
3. choisir le skill `sf-*` applicable ;
4. lire entièrement ce skill et les fichiers qu’il référence ;
5. exécuter explicitement les préconditions et scripts protégés ;
6. signaler toute capacité native manquante au lieu de simuler une réussite.

## Skills principaux

Les skills principaux couvrent la boucle de développement répétable sans identifiants externes :

| Domaine      | Exemples                                            | Responsabilité                                          |
| ------------ | --------------------------------------------------- | ------------------------------------------------------- |
| Git          | `sf-git-commit`, `sf-git-create-pr`, `sf-git-merge` | Politique de branche, commit et pull request            |
| Qualité      | `sf-utils-fix-errors`, `sf-utils-fix-grammar`       | Correction ciblée en préservant le travail sans rapport |
| Workflow     | `sf-workflow`                                       | Parcours Team/Solo protégés et extension personnalisée  |
| Architecture | `sf-integration-rules`                              | Implémentation complète entre les couches               |

`sf-workflow` est un skill unique qui adapte sa rigueur à la complexité. Le preset équipe utilise sept statuts et Solo en utilise cinq. Les modèles personnalisés enregistrent une autre séquence, mais
nécessitent des documents et garde-fous écrits par l'équipe avant de former un contrat de livraison. La complexité (`bug`, `low`, `medium`, `complex`) module la rigueur à l’intérieur du workflow ;
elle ne sélectionne pas un autre skill.

## Skills d’outils et niveaux de prise en charge réels

Les skills d’outils peuvent nécessiter des identifiants propres à l’utilisateur, conservés hors du dépôt.

| Surface                             | État en v1                                                                       |
| ----------------------------------- | -------------------------------------------------------------------------------- |
| Workflow GitHub Projects            | Adaptateur de livraison complet                                                  |
| Workflow Jira                       | Adaptateur expérimental                                                          |
| Workflow Linear                     | Adaptateur expérimental                                                          |
| SRS Notion                          | Backend SRS v1 complet                                                           |
| Contexte Atlassian, Notion ou Figma | Skills optionnels ; capacité dépendante des identifiants et de l’accès de l’hôte |

Des interfaces indépendantes des outils rendent possibles de futurs adaptateurs ; elles ne signifient pas que tous les adaptateurs sont aussi complets aujourd’hui.

## Tickets enfants natifs et preuves de test

Le skill de workflow crée de vrais sous-tickets au moyen de l’outil de board configuré, jamais des cases Markdown. Il publie un plan de test avant l’exécution et un rapport après la validation. Dans
le preset équipe, la même pull request passe de la validation fonctionnelle en brouillon (`Human testing`) à la revue de code prête (`In review`).

## Skills personnalisés

Un skill propre au projet doit utiliser le même préfixe et garder un périmètre étroit :

```text
.claude/skills/sf-deploy-preview/
├── SKILL.md
├── scripts/
└── references/
```

Placez la logique réutilisable dans des scripts, gardez les identifiants secrets hors de Git et documentez les fichiers possédés par le skill. Si le skill participe à une transition, étendez le
workflow protégé au lieu de modifier directement le board.

## Mettre les skills à jour sans risque

`sf update` compare le fichier installé, sa base enregistrée et la nouvelle version amont :

- un fichier intact peut avancer automatiquement ;
- une modification utilisateur produit un conflit explicite ;
- un fichier supprimé en amont n’est pas confondu avec un contenu appartenant à l’utilisateur ;
- une déclaration d’agent n’autorise jamais la suppression d’instructions ou réglages sans rapport.

## Diagnostic

```bash
sf skill list
sf skill describe sf-workflow
sf agents list --json
sf agents doctor codex claude-code
sf status --agent-friendly --no-network
```

## Continuer

- [Vue d’ensemble des skills](/fr/skills/overview)
- [Skills principaux](/fr/skills/core-skills)
- [Skills d’outils](/fr/skills/tool-skills)
- [Créer des skills](/fr/skills/creating-skills)
- [Coexistence des agents](/fr/guide/agent-coexistence)
