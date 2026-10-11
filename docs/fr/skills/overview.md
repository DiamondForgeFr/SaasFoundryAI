# Vue d'ensemble des skills

SaaSFoundryAI installe des skills `sf-*` appartenant au projet, qui expliquent comment travailler en sécurité dans l'architecture générée. Elles constituent une documentation exécutable pour les
agents de code : garde-fous du workflow, grammaire d'intégration, opérations Git, procédures SRS et adaptateurs d'outils externes vivent à côté du code qu'ils encadrent.

## Pourquoi chaque skill du projet commence par `sf-`

- `sf-workflow`, et non un `workflow` générique ;
- `sf-git-commit`, et non un `commit` générique ;
- `sf-tool-github-projects`, et non un assistant GitHub générique.

Le préfixe empêche une skill installée globalement de remplacer silencieusement la politique du projet. Dans un projet SaaSFoundryAI, les agents privilégient la procédure `sf-*` du dépôt chaque fois
qu'une capacité générique et une capacité propre au projet coexistent.

## Catégories de skills

| Catégorie               | Installation                                    | Exemples                                                                   |
| ----------------------- | ----------------------------------------------- | -------------------------------------------------------------------------- |
| Principale              | À chaque installation du harness                | `sf-git-commit`, `sf-git-create-pr`, `sf-utils-fix-errors`                 |
| Workflow                | Lorsqu'un workflow est configuré                | `sf-workflow` et la skill du tableau choisi                                |
| Grammaire d'intégration | Lorsqu'une application générée est gérée        | `sf-integration-rules`                                                     |
| SRS                     | Lorsque le SRS est activé                       | `sf-srs` et son adaptateur de backend                                      |
| Outil facultatif        | Choisi pendant l'installation ou la mise à jour | `sf-tool-context7`, `sf-tool-atlassian`, `sf-tool-notion`, `sf-tool-figma` |

## Une source, plusieurs points d'entrée d'agents

`AGENTS.md` contient les instructions du projet pour tous les agents ; `.claude/skills/` reste la source gérée des skills :

```text
AGENTS.md                     # instructions de référence du projet pour tous les agents
.claude/skills/               # source gérée utilisée par Claude Code et scripts protégés
.claude/rules/claude-code.md  # instructions propres à Claude Code, si claude-code est déclaré
.agents/skills/               # copies partagées pour les profils déclarés autres que Claude Code
GEMINI.md                     # importe AGENTS.md, si gemini-cli est déclaré
```

Les fichiers exacts dépendent des profils déclarés dans `.saasfoundry.json`. Un nouveau projet ne reçoit pas de `CLAUDE.md` ; un projet installé avant que `AGENTS.md` ne fasse foi conserve son
`CLAUDE.md` jusqu'à sa migration dans une version ultérieure de `sf update`. `sf agents list`, `sf agents doctor` et `sf status --agent-friendly --no-network` rapportent les déclarations et la
présence des fichiers. Ils ne prétendent pas qu'un hôte a découvert les skills, exécuté les hooks ou reçu des identifiants ; vérifiez ces comportements dans l'hôte réel.

Les multirepos générés placent le harness géré là où chaque dépôt en a besoin. Les monorepos peuvent centraliser la surface d'instructions partagée à la racine. Consultez
[la coexistence des agents](/fr/guide/agent-coexistence) et [la structure du projet](/fr/guide/project-structure) pour la topologie exacte.

## Comment un agent utilise une skill

1. Lire le point d'entrée d'instructions du projet.
2. Inspecter `.saasfoundry.json` pour la topologie, les modules, les profils d'agents et le workflow.
3. Choisir la skill `sf-*` correspondante dans la racine de skills déclarée.
4. Lire son `SKILL.md` complet ainsi que les fichiers de statut et de référence qu'il cite.
5. Exécuter les scripts protégés au lieu de reproduire manuellement leurs effets.

Certains hôtes prennent en charge la découverte par mots-clés ou les commandes slash ; d'autres exigent que l'agent lise la skill explicitement. SaaSFoundryAI documente à la fois la capacité attendue
et la limite de l'hôte, au lieu de prétendre que chaque runtime se comporte comme Claude Code.

## Skill de workflow et adaptateurs de tableau

`sf-workflow` porte la sémantique de livraison. Une skill de tableau effectue les opérations réelles sur les tickets.

| Adaptateur                | Statut v1                                                                |
| ------------------------- | ------------------------------------------------------------------------ |
| `sf-tool-github-projects` | Contrat de livraison v1 complet                                          |
| Adaptateur Jira           | Expérimental ; aucune promesse de parité des garde-fous ni de hiérarchie |
| Adaptateur Linear         | Expérimental ; aucune promesse de parité des garde-fous ni de hiérarchie |
| Notion                    | Backend SRS v1 complet ; pas un outil de suivi complet du workflow       |

La skill de workflow lit la séquence de statuts configurée, qu'il s'agisse du préréglage d'équipe à sept statuts, du préréglage Solo à cinq statuts ou d'un modèle personnalisé. Elle n'a jamais besoin
d'une skill de workflow « avancée » distincte : la complexité règle la profondeur de l'analyse et de la revue au sein de l'unique workflow.

## Découverte et diagnostic

```bash
sf skill list
sf skill describe sf-workflow
sf agents list --json
sf agents doctor codex claude-code
sf status --agent-friendly --no-network
```

Pour consulter directement la source gérée :

```bash
cat .claude/skills/sf-workflow/SKILL.md
cat .agents/skills/sf-workflow/SKILL.md
```

Utilisez le chemin qui existe pour l'hôte courant déclaré. Ne copiez pas de skills personnelles ou globales dans le dépôt et ne déduisez aucun consentement d'un répertoire découvert.

## Mises à jour et personnalisation locale

`sf update` compare les fichiers de skills gérés avec la référence enregistrée dans `.saasfoundry.json` :

- les fichiers gérés inchangés peuvent être mis à jour automatiquement ;
- les modifications locales deviennent des conflits explicites au lieu d'être écrasées silencieusement ;
- les identifiants restent hors du dépôt ;
- les déclarations d'agents partagées et les fichiers d'instructions restent des modifications examinables.

Si une convention est propre à votre produit, créez une skill personnalisée `sf-*` dans le projet et documentez qui en est responsable. Consultez [créer des skills](/fr/skills/creating-skills).

## Pour aller plus loin

- [Skills principales](/fr/skills/core-skills)
- [Skills d'outils](/fr/skills/tool-skills)
- [Créer des skills](/fr/skills/creating-skills)
- [Architecture du système de skills](/fr/guide/skills-system)
- [Coexistence des agents](/fr/guide/agent-coexistence)
