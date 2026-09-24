# Créer des skills

SaaSFoundryAI fournit un catalogue sélectionné — consultez les [skills principales](/fr/skills/core-skills) et les [skills d'outils](/fr/skills/tool-skills) — mais votre projet aura ses propres
conventions : vocabulaire métier, script de release personnalisé ou checklist de déploiement propre à votre infrastructure. Une **skill personnalisée** transmet ces conventions à l'agent de code afin
que chaque contributeur, humain ou agent, les applique de manière identique.

Cette page explique comment construire une skill **dans votre projet**. Pour proposer une skill à SaaSFoundryAI lui-même, consultez le guide de [contribution](/fr/contributing/development).

## Une skill en vingt secondes

Une skill est un dossier contenant au minimum un fichier `SKILL.md`. Son emplacement dépend de l'hôte déclaré : `.claude/skills/` pour Claude Code, `.agents/skills/` pour les agents utilisant la
surface portable, dont Codex.

Le fichier `SKILL.md` contient :

- une référence Markdown que l'agent lit intégralement avant d'agir ;
- un frontmatter YAML qui décrit les métadonnées de la skill, notamment son nom, sa description et, selon l'hôte, les outils autorisés ou mots-clés de déclenchement.

Lorsque votre demande correspond aux déclencheurs et que l'hôte sait les découvrir, celui-ci charge le fichier complet avant d'agir. Une invocation explicite comme `/skill-name` produit le même
résultat dans les hôtes qui prennent cette syntaxe en charge. Sinon, les instructions du projet demandent à l'agent de lire explicitement la skill applicable.

## Exemple minimal : `deploy-preview`

Créons une skill qui décrit le rituel de déploiement d'un environnement de prévisualisation.

### 1. Créer le dossier

Dans un projet multirepo, placez-la sous l'application propriétaire du comportement — `apps/api/` pour l'API, `apps/web/` pour le frontend. Dans un monorepo, utilisez la racine. Exemple Claude Code :

```bash
mkdir -p .claude/skills/sf-deploy-preview
```

Pour une skill portable partagée avec Codex, utilisez la surface `.agents/skills/sf-deploy-preview` et référencez-la depuis `AGENTS.md`. Si plusieurs agents doivent la consommer, choisissez une source
de vérité et des enveloppes de référence plutôt que de laisser deux copies diverger.

Conservez le préfixe `sf-` afin d'éviter les collisions avec des skills installées globalement.

### 2. Écrire `SKILL.md`

```markdown
---
name: deploy-preview
description: Deploy a preview environment for the current feature branch. Auto-triggers on "deploy preview", "spin up preview", "ephemeral env". Use after Human testing, before opening the PR.
model: haiku
allowed-tools: Bash(gh :*), Bash(fly :*), Bash(git :*)
---

# Deploy preview

Spin up a short-lived preview environment on Fly.io for the current feature branch, comment the URL back on the ticket, and (if the Human testing status wants it) post a screenshot.

## Preconditions

- Clean working tree (`git status` empty)
- Pushed branch (`git log origin/$BRANCH..HEAD` empty)
- Ticket is in Human testing (checked via `$CLI status <N>`)

## Workflow

1. Resolve the ticket number from the current branch name (`feature/N-*`)
2. Build the preview Docker image: `docker build -t myapp-preview:$BRANCH`
3. Deploy to Fly.io: `fly deploy --app myapp-preview-$BRANCH`
4. Wait for the health check: poll `https://myapp-preview-$BRANCH.fly.dev/api/health` until 200
5. Post the URL as a comment on the GitHub ticket: `gh issue comment <N> --body "Preview: https://..."`
6. Post in Slack #engineering if the repo contains a .saasfoundry-slack webhook

## Rollback

If step 3 fails, run `fly apps destroy myapp-preview-$BRANCH` before exiting.

## Rules

- Never deploy to production from this skill
- Never skip the health check wait — the URL posted must actually respond
- The preview name includes the branch, so concurrent previews don't collide
```

C'est tout : aucun TypeScript ni fichier JSON. L'agent lit simplement le Markdown. Le frontmatter `allowed-tools` limite les commandes qu'un hôte compatible peut réellement invoquer — ici `gh`, `fly`
et `git`, rien d'autre. Les champs comme `model` sont propres à certains hôtes ; ne les présentez pas comme une garantie portable.

### 3. Facultatif : ajouter un script CLI

Lorsqu'une skill encapsule des interactions complexes, placez la logique dans un script shell voisin de `SKILL.md`, puis référencez-le depuis le workflow :

```
.claude/skills/sf-deploy-preview/
├── SKILL.md
├── deploy-preview.sh    # Script de déploiement réel
└── README.md            # Documentation destinée aux humains
```

La section `## Workflow` de `SKILL.md` appelle alors le script :

```markdown
1. Run `bash .claude/skills/sf-deploy-preview/deploy-preview.sh $BRANCH`
```

C'est le modèle utilisé par `sf-tool-github-projects`, `sf-tool-atlassian` et les skills d'outils livrées avec SaaSFoundryAI.

### 4. Tester l'invocation

Dans Claude Code, testez les deux chemins :

```
> /sf-deploy-preview
```

La commande doit charger la skill et exécuter le workflow. Puis formulez naturellement :

```
> spin up a preview environment for this branch
```

Les mots-clés doivent déclencher la skill sans préfixe `/`. Dans Codex ou un autre hôte, vérifiez le mécanisme déclaré par son profil avec `sf agents doctor`, puis demandez la capacité en langage
naturel. L'existence d'un fichier ne prouve pas la découverte native.

### 5. Commiter

```bash
git add .claude/skills/sf-deploy-preview/
git commit -m "feat(#N): add sf-deploy-preview skill"
```

La skill fait désormais partie du projet. Toute personne qui clone le dépôt la reçoit ; sa découverte dépend ensuite des agents déclarés et de leurs points d'entrée.

## Écrire un bon `SKILL.md`

Les modèles suivants, issus des skills SaaSFoundryAI, rendent leur exécution fiable.

### Frontmatter : une `description` précise

Le champ `description` aide l'agent à décider s'il doit charger la skill. Une description vague provoque un mauvais chargement, ou pire, une absence de chargement.

**À éviter** :

```yaml
description: Helps with deployments
```

**Préférable** :

```yaml
description: Deploy a preview environment for the current feature branch. Auto-triggers on "deploy preview", "spin up preview", "ephemeral env". Use after Human testing, before opening the PR.
```

Regroupez les mots-clés de déclenchement dans la description lorsque l'hôte les exploite.

### Corps : commencer par les préconditions

Indiquez ce qui doit être vrai avant l'exécution. L'agent peut ainsi s'arrêter proprement si le contexte ne convient pas, au lieu de livrer un résultat à moitié terminé :

```markdown
## Preconditions

- Clean working tree (`git status` empty)
- Pushed branch
- Ticket is in Human testing
```

Les presets Team et Solo appliquent ce principe avec leurs parcours livrés. Un parcours personnalisé exige des documents de statut et des garde-fous correspondants avant d'offrir le même contrat.

### Corps : des étapes `## Workflow` explicites

Utilisez des étapes numérotées plutôt qu'un paragraphe. Chaque étape représente une invocation CLI ou une décision. Si elle contient des sous-étapes, déplacez celles-ci dans une section dédiée. Une
skill devient ainsi débogable : lorsqu'un problème survient, l'étape fautive est identifiable.

### Corps : terminer par `## Rules` ou `## Gotchas`

Ajoutez quelques règles sur les aspects surprenants :

```markdown
## Rules

- Never deploy to production from this skill
- The preview name includes the branch name, so concurrent previews don't collide
- Credentials are in `~/.claude/credentials/fly/` — never display or log
```

Les connaissances informelles qui resteraient autrement dans des messages Slack deviennent alors durables et révisables.

### Réduire `allowed-tools`

Chaque outil autorisé élargit la surface d'action. Si une skill n'utilise que `git` et `gh`, n'autorisez pas tout `Bash` :

```yaml
allowed-tools: Bash(git :*), Bash(gh :*)
```

Lorsqu'un processus externe ne doit pas être autorisé globalement, utilisez un motif Bash précis. Ce champ reste une capacité d'hôte : complétez-le par des règles écrites et les contrôles du CLI, sans
supposer que tous les agents l'appliquent nativement.

## Partager une skill avec l'équipe

Une skill personnalisée est un fichier normal du dépôt :

- **Git la suit.** Toute personne qui récupère la branche la reçoit.
- **La revue de code s'applique.** L'équipe peut la commenter comme tout autre fichier.
- **`sf update` la préserve.** Hors de la table des hashes du scaffold, elle n'est pas proposée à l'écrasement.

Dans un monorepo, placez la source à la racine pour la partager entre `apps/api` et `apps/web`.

Dans un multirepo, dupliquez-la sous `apps/api` et `apps/web` si elle concerne les deux, ou maintenez une source de vérité avec une référence dans l'autre dépôt. Cette dernière option réduit la
duplication au prix d'une coordination supplémentaire entre dépôts.

Lorsque plusieurs agents sont activés, évitez les copies indépendantes entre `.claude/skills` et `.agents/skills`. Adoptez une source et des points d'entrée qui demandent explicitement de la lire.

## Relier une skill au workflow

Une skill personnalisée peut être appelée par les transitions de `sf-workflow`. Vous pourriez, par exemple, demander à `sf-workflow` d'exécuter `sf-deploy-preview` lors de l'entrée en Human testing.

Pour cela, **ne modifiez pas directement `sf-workflow`** : `sf update` remplacerait ces changements à la prochaine mise à niveau. À la place :

1. créez un fichier de **hook de pré-transition** près de la skill de workflow : `.claude/skills/sf-workflow/hooks/pre-human-testing.sh` ;
2. le hook reçoit le numéro du ticket dans `$1` ;
3. appelez depuis ce hook votre skill ou votre script personnalisé.

Vos personnalisations restent ainsi séparées du code de scaffold géré par `sf update`. Le dossier `hooks/` livré contient un exemple commenté.

## Promouvoir une skill dans SaaSFoundryAI

Si une skill personnalisée devient utile dans plusieurs de vos projets, envisagez une PR pour l'intégrer au catalogue SaaSFoundryAI. Elle sera alors livrée avec tous les nouveaux projets, et plus
seulement celui où elle est née.

Consultez la checklist de [contribution](/fr/contributing/development) : duplication dans les surfaces de scaffold concernées, tests et mise à jour de la documentation.

## Étapes suivantes

- Lisez quelques fichiers `SKILL.md` livrés, par exemple `cat .claude/skills/sf-git-commit/SKILL.md` : ce sont les meilleures références pratiques.
- Consultez la [référence de `sf skill`](/fr/cli/sf-skill) pour gérer les skills.
- Découvrez le [système de skills](/fr/guide/skills-system) pour son architecture conceptuelle.
