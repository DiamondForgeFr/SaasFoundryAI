# Skills principales

Les **skills principales** sont livrées dans chaque projet généré. Sans dépendance externe ni identifiant, elles couvrent la boucle quotidienne de développement : commits, pull requests, merges,
correction d'erreurs et workflow qui relie l'ensemble.

Elles sont au nombre de sept.

## Catalogue

| Skill                                               | Mots-clés de déclenchement automatique                                    | Fonction                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| [`sf-git-commit`](#sf-git-commit)                   | « commit », « save changes »                                              | Génère un message conventionnel, commit et pousse                    |
| [`sf-git-create-pr`](#sf-git-create-pr)             | « open a PR », « create a pull request »                                  | Ouvre une PR vers la branche cible configurée avec un corps généré   |
| [`sf-git-fix-pr-comments`](#sf-git-fix-pr-comments) | « implement the review comments », « address the PR feedback »            | Récupère les commentaires, applique chaque modification et commit    |
| [`sf-git-merge`](#sf-git-merge)                     | « merge the branches », « resolve conflicts »                             | Résout les conflits en tenant compte du contexte                     |
| [`sf-utils-fix-errors`](#sf-utils-fix-errors)       | « fix errors », « fix typescript », « fix eslint »                        | Répartit la correction des erreurs ESLint et TypeScript dans le code |
| [`sf-utils-fix-grammar`](#sf-utils-fix-grammar)     | « fix grammar », « spellcheck the docs »                                  | Corrige grammaire et orthographe sans modifier la mise en forme      |
| [`sf-workflow`](#sf-workflow)                       | « workflow status », « next step », « complexity », « detect complexity » | Orchestre le cycle configuré et ses garde-fous                       |

## `sf-git-commit`

**Philosophie** : privilégier la rapidité. La skill analyse l'arbre de travail, produit un bon message de commit conventionnel, commit et pousse sans poser de question superflue.

**Invocation typique** :

```
Utilisateur : « commit these changes »
Agent : [ajoute automatiquement les fichiers si rien n'est indexé]
        [écrit `feat(#42): add /api/version endpoint`]
        [git commit && git push]
```

Le **format du commit** suit `.saasfoundry.json → workflow.commitFormat.pattern` :

```
<type>(#<ticket>): <description>
```

Types : `feat`, `fix`, `update`, `docs`, `chore`, `refactor`, `test`, `perf`, `revert`. Le hook de pre-commit — Prettier, ESLint, tsc et Jest — s'exécute avant le push. En cas d'échec, le commit est
bloqué. La skill respecte cette décision et n'utilise jamais `--no-verify`.

**Quand la contourner** : si vous souhaitez rédiger vous-même le message, faites simplement le commit à la main. `sf-git-commit` ne s'y oppose pas.

## `sf-git-create-pr`

Ouvre une pull request depuis la branche de fonctionnalité courante vers la branche définie dans `.saasfoundry.json → workflow.prTargetBranch`, généralement `develop`.

**La PR générée contient** :

- un titre au format de commit conventionnel, par exemple `feat(#42): add /api/version endpoint` ;
- un résumé, la liste des commits et une checklist de test ;
- un lien retour vers le ticket du workflow ;
- le déclenchement CI approprié à son état draft ou prêt pour revue.

**Préconditions appliquées** :

- l'arbre de travail est propre ;
- la branche courante est poussée ;
- la branche de base existe sur le remote ;
- le ticket a terminé AI testing avant la création de la PR draft destinée à Human testing.

Si une précondition manque, la skill l'explique et s'arrête. Elle ne contourne jamais le workflow. Après validation humaine, le workflow rend la même PR prête pour revue avant le passage en In review.

## `sf-git-fix-pr-comments`

Lorsque des relecteurs commentent la PR, cette skill récupère les discussions, les groupe par fichier et les traite une à une : modification du code, commit et push. Elle produit un commit par groupe
cohérent de commentaires.

**Invocation typique** : `"implement the review comments"`, ou explicitement `/sf-git-fix-pr-comments`.

Elle appelle en interne `gh api repos/:owner/:repo/pulls/:number/comments` et parcourt les discussions. Elle ignore celles déjà résolues et répond brièvement sur chaque discussion traitée, par exemple
« Fixed in abc1234 ».

## `sf-git-merge`

Un résolveur de conflits léger et conscient du contexte pour les rares cas où `git merge` s'interrompt. Il lit les blocs en conflit, consulte `.saasfoundry.json` pour comprendre le rôle des branches —
travail ou release — et propose une résolution. L'utilisateur approuve avant toute écriture.

Ce n'est pas un bouton de merge magique. La plupart des merges SaaSFoundryAI restent sans conflit car l'équipe rebase habituellement les branches. Utilisez cette skill lorsqu'une branche de
fonctionnalité longue doit rejoindre un `develop` très actif.

## `sf-utils-fix-errors`

Exécute `npm run lint` et `npm run type-check`, puis analyse la sortie. Pour chaque diagnostic, elle corrige le fichier concerné en respectant les conventions du projet : pas de `any`, d'import
inutilisé ni de commentaire de contournement.

**Ce qu'elle fait** :

- ajouter les imports manquants ;
- corriger les paramètres génériques incorrects ;
- renommer les variables selon les conventions ;
- corriger les avertissements ESLint évidents.

**Ce qu'elle ne fait pas** :

- masquer une erreur avec `// @ts-expect-error` ou `// eslint-disable-next-line` ;
- modifier la signature d'une API publique ;
- réécrire la logique d'une fonction.

Si corriger l'erreur exige de revoir la logique, la skill le signale et rend la main avec un résumé d'une ligne.

## `sf-utils-fix-grammar`

Relit la grammaire, l'orthographe et la clarté du Markdown, des blocs JSDoc et des chaînes de traduction. Elle préserve la mise en forme — blocs de code, tableaux et frontmatter — ainsi que les termes
techniques.

**Usage typique** : après une série de développements, demandez `"grammar pass on docs/"` avant la PR.

## `sf-workflow`

La skill principale la plus importante est aussi celle que vous invoquerez le moins explicitement, car les autres s'y connectent.

**Fonctions** :

- lire l'étiquette de complexité du ticket — `bug`, `low`, `medium` ou `complex` — et adapter le niveau de contrôle ;
- lire le preset configuré : Team utilise sept statuts et Solo en utilise cinq ; Custom enregistre une configuration avancée ;
- connaître les actions obligatoires et les critères de sortie livrés pour les statuts Team et Solo ;
- interdire à l'agent d'inventer un raccourci hors des parcours protégés ;
- appeler la **skill d'outil du workflow** correspondante pour déplacer réellement le ticket sur le tableau.

GitHub Projects porte le workflow V1 complet. Les adaptateurs Jira et Linear sont expérimentaux. Notion est le backend SRS V1 complet, pas un outil de suivi complet du workflow.

**Utilisation explicite** :

```bash
/sf-workflow status 42                # Quel est le statut du ticket 42 et quelle est la suite ?
/sf-workflow detect-complexity 42     # Suggérer une complexité depuis sa description
/sf-workflow validate 42              # Le ticket peut-il avancer ?
/sf-workflow next 42                  # Quelle est exactement la prochaine action ?
```

**La configuration réside dans `.saasfoundry.json`** : branches, cible des PR, noms des statuts et format des commits. La politique de branche et de cible est lue depuis ce contrat. En v1, renommer
arbitrairement un statut exige aussi des documents de statut et des garde-fous adaptés ; modifier le manifeste seul ne les génère pas.

Le preset Team sépare **Human testing**, la validation fonctionnelle d'une PR brouillon, de **In review**, la revue de code d'une PR prête. Solo retire le statut Human testing séparé et utilise la
revue de PR comme contrôle humain.

Consultez le [système de workflow](/fr/workflow/introduction) pour les trois choix et le [workflow Team à sept statuts](/fr/workflow/7-status-system) pour le détail du preset complet.

## Examiner la source d'une skill

Chaque skill principale est lisible par un humain :

```bash
cat .claude/skills/sf-git-commit/SKILL.md        # Multirepo : apps/api/.claude/…
```

Le frontmatter en tête de chaque `SKILL.md` déclare notamment :

- `name` — identifiant utilisé pour une invocation explicite ;
- `description` — fonction de la skill et mots-clés de déclenchement ;
- les éventuelles métadonnées propres à l'hôte ;
- `allowed-tools` lorsque l'hôte le prend en charge — outils que la skill est autorisée à appeler.

Ces fichiers sont la source de vérité. Les lire reste le moyen le plus rapide de comprendre ce qu'une skill fera réellement. Le mécanisme exact de découverte dépend de l'hôte : Claude Code s'appuie
sur ses fichiers `CLAUDE.md` et `.claude/skills`, tandis que Codex utilise `AGENTS.md` et `.agents/skills`.

## Étapes suivantes

- [Skills d'outils](/fr/skills/tool-skills) — intégrations facultatives à des services externes
- [Créer des skills](/fr/skills/creating-skills) — écrire les vôtres
- [Référence de `sf skill`](/fr/cli/sf-skill) — gérer le cycle de vie d'une skill
