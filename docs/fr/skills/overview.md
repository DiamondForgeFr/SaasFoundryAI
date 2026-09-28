# Vue d'ensemble des skills

SaaSFoundryAI fournit un catalogue de **skills pour agents de code** dans chaque projet généré. Une skill est une capacité courte et ciblée, chargée automatiquement selon les mécanismes de l'hôte ou
appelée explicitement. Elle permet à l'agent de suivre durablement les conventions du projet.

## Le préfixe `sf-` et son importance

Chaque skill SaaSFoundryAI commence par `sf-` :

- `sf-git-commit`, et non `git-commit` ;
- `sf-tool-atlassian`, et non `tool-atlassian` ;
- `sf-workflow`, et non `workflow`.

Ce préfixe est le contrat qui permet aux skills du projet de coexister avec celles installées globalement sans collision. Lorsqu'une instruction générée demande de privilégier les skills `sf-*`, c'est
parce qu'une skill globale `git-commit` pourrait appliquer de mauvaises règles à ce dépôt ; la variante `sf-` est celle du projet.

## Trois catégories

| Catégorie             | Installation                                                  | Identifiants  | Exemples                                                  |
| --------------------- | ------------------------------------------------------------- | ------------- | --------------------------------------------------------- |
| **Principale**        | Toujours, dans chaque projet généré                           | Aucun         | `sf-git-commit`, `sf-utils-fix-errors`, `sf-workflow`     |
| **Outil**             | Sur demande pendant `sf new` ou via `sf update --add-modules` | Parfois       | `sf-tool-context7`, `sf-tool-atlassian`, `sf-tool-notion` |
| **Outil du workflow** | Un par projet, aligné sur l'outil de tableau choisi           | Selon l'outil | `sf-tool-github-projects` pour le workflow V1 complet     |

GitHub Projects fournit aujourd'hui le workflow V1 complet. Jira et Linear restent expérimentaux. Notion est le backend SRS V1 complet, mais pas un outil de suivi complet du workflow.

Consultez les [skills principales](/fr/skills/core-skills), les [skills d'outils](/fr/skills/tool-skills) et le guide pour [créer vos propres skills](/fr/skills/creating-skills).

## Emplacement des skills

Dans un projet **multirepo**, chaque application possède sa propre copie des surfaces de skills correspondant aux agents activés :

```
apps/api/.claude/skills/
apps/api/.agents/skills/
apps/web/.claude/skills/
apps/web/.agents/skills/
```

Dans un **monorepo**, elles sont centralisées à la racine :

```
.claude/skills/
.agents/skills/
```

Les répertoires réellement déposés dépendent des agents déclarés dans le harness. Claude Code lit les instructions `CLAUDE.md` et les skills Claude ; Codex suit `AGENTS.md` et `.agents/skills`. Le CLI
conserve un inventaire explicite au lieu de déduire un agent de la présence d'un fichier.

## Invocation des skills

**Déclenchement automatique** — lorsque l'hôte le permet, l'agent active une skill en reconnaissant des mots-clés pertinents :

| Demande                              | Skill chargée automatiquement |
| ------------------------------------ | ----------------------------- |
| « commit these changes »             | `sf-git-commit`               |
| « fix the typescript errors »        | `sf-utils-fix-errors`         |
| « create a PR »                      | `sf-git-create-pr`            |
| « what's the status of ticket #42? » | `sf-workflow`                 |
| « use context7 for the NestJS docs » | `sf-tool-context7`            |

**Invocation explicite** — utilisez la forme prise en charge par votre hôte, par exemple avec Claude Code :

```
/sf-git-commit
/sf-workflow status 42
/sf-tool-atlassian jira issue PROJ-123
```

Avec un hôte qui ne propose pas de commande `/skill-name`, demandez simplement la capacité en langage naturel ou lisez explicitement le `SKILL.md` référencé par les instructions du projet.

**Chaînage** — une skill peut en appeler une autre. `sf-workflow` s'appuie sur `sf-tool-github-projects` pour déplacer les tickets sur le tableau ; vous n'avez pas à manipuler directement GraphQL.

## Synchronisation par le CLI

`sf update` propage l'évolution des skills comme celle des autres fichiers du scaffold. Si une nouvelle version de `sf-git-commit` est publiée, `sf update` propose de remplacer votre copie ou signale
un conflit si vous l'avez personnalisée.

Deux invariants traversent les mises à jour :

- **Les skills principales restent installées.** `sf update` les redépose si elles manquent. Leur suppression manuelle n'est pas conservée comme désinstallation.
- **Les identifiants des skills d'outils sont préservés.** La logique de la skill peut évoluer, mais les secrets restent dans l'espace utilisateur et ne sont jamais écrasés par `sf update`.

## Découverte

Listez les skills du projet courant :

```bash
sf skill list
```

Affichez les détails d'une skill — déclencheurs, outils autorisés et point d'entrée CLI :

```bash
sf skill describe sf-git-commit
```

Lisez directement la référence la plus explicite :

```bash
cat .claude/skills/sf-git-commit/SKILL.md
```

Pour un autre hôte déclaré, consultez son point d'entrée et son répertoire partagés, par exemple `AGENTS.md` et `.agents/skills` pour Codex. La présence d'un fichier ne prouve pas à elle seule sa
découverte native ; `sf agents doctor` distingue les artefacts présents des capacités vérifiées de l'hôte.

## Étapes suivantes

- **Utiliser une skill précise** → [skills principales](/fr/skills/core-skills) ou [skills d'outils](/fr/skills/tool-skills)
- **Créer une skill absente** → [créer des skills](/fr/skills/creating-skills)
- **Comprendre l'architecture** → [système de skills](/fr/guide/skills-system)
- **Gérer les comptes des outils** → [référence de `sf tools`](/fr/cli/sf-tools)
