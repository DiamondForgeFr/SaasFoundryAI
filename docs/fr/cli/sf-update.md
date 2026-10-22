# sf update

Faites évoluer un projet géré sans perdre vos changements. `sf update` est la commande de cycle de vie d'un projet SaaSFoundryAI existant. Elle découvre le projet grâce à `.saasfoundry.json`, migre
les métadonnées et modules gérés si nécessaire, compare les nouveaux templates à vos fichiers et peut ajouter des capacités écartées lors de la création.

```bash
sf update [options]
```

::: tip Prévisualiser d'abord

Utilisez `sf update --dry-run --json` avant une mise à jour automatisée ou importante. La prévisualisation n'écrit aucun fichier et ne lance aucun installateur ; son rapport versionné indique toujours
`"mutated": false`.

:::

## Le cycle de mise à jour

| Étape                      | Ce que fait `sf update`                                                                                                             | Limite de sécurité                                                       |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **1. Découvrir**           | Lit le manifeste racine et classe le stack, le harness, la topologie, les modules et leurs versions.                                | Un manifeste absent ou incohérent arrête la mise à jour normale.         |
| **2. Récupérer et migrer** | Récupère une transition technique interrompue, puis exécute les migrations de manifeste et de modules lors d'une vraie application. | Une version n'avance qu'après la réussite de sa migration.               |
| **3. Planifier**           | Régénère le template sélectionné à l'écart et calcule les ajouts de modules ou la transition de profil.                             | Le dry-run isole la génération et les effets fournisseurs.               |
| **4. Comparer**            | Compare la base enregistrée, les octets actuels et le nouveau template.                                                             | Vos modifications deviennent des conflits explicites.                    |
| **5. Appliquer**           | Écrit les ajouts et changements sûrs, puis suit la stratégie de conflit choisie.                                                    | Par défaut, un fichier divergent n'est pas écrasé : un sidecar est créé. |
| **6. Enregistrer**         | Persiste les capacités, versions de modules, ports, propriétés et nouvelles bases.                                                  | La prochaine exécution repart du dernier état terminé.                   |

Lancez la commande depuis le dossier qui possède le `.saasfoundry.json` concerné. Pour une transition de profil multirepo, il s'agit du coordinateur racine, pas d'une projection API ou web.

## Le manifeste est le contrat partagé

`.saasfoundry.json` relie trois dimensions :

- **Reproduction par le CLI :** topologie, ports, modules, fournisseurs et choix de génération décrivent le projet.
- **Propriété sûre :** `fileHashes` enregistre le contenu géré en dernier par SaaSFoundry ; `unmanagedPaths` conserve les chemins adoptés ou utilisateur hors de cette frontière.
- **Harness de développement :** workflow, agents, outils et configuration SRS indiquent aux hôtes de code les règles et intégrations actives.

Versionnez le manifeste avec les fichiers qu'il décrit. Ne copiez pas celui d'un autre projet et ne modifiez pas ses empreintes à la main : l'algorithme dépend de leur relation avec ce dépôt précis.

## Prévisualiser sans mutation

Prévisualisation lisible :

```bash
sf update --dry-run
```

Prévisualisation exploitable par une machine :

```bash
sf update --dry-run --json > plan-mise-a-jour-saasfoundry.json
```

`--json` exige `--dry-run`. Le CLI réserve stdout à un seul objet JSON versionné et envoie les diagnostics sur stderr. Le rapport peut lister les actions de template, les migrations de modules en
attente avec le changement que chacune ferait (`moduleMigrations`), les modules choisis, les blocages de transition, codes de raison et remédiations exécutables, sans exposer le contenu des fichiers
candidats ni demander les secrets fournisseurs.

Un dry-run n'est pas un jeton d'autorisation pour l'application. Relisez-le, gardez un arbre Git propre, puis relancez une commande d'application qui exprime la même intention.

## Comparaison des fichiers à trois voies

Pour chaque chemin géré, le CLI compare :

| Entrée     | Signification                                              | Source                               |
| ---------- | ---------------------------------------------------------- | ------------------------------------ |
| **Base**   | Les octets enregistrés lors de la dernière gestion.        | `.saasfoundry.json` → `fileHashes`   |
| **Actuel** | Les octets présents dans l'arbre de travail.               | Lecture au moment de la mise à jour. |
| **Cible**  | Les octets que le CLI actuel générerait pour ce manifeste. | Régénération isolée.                 |

La décision reste conservative :

| Situation                                                   | Résultat                                                  |
| ----------------------------------------------------------- | --------------------------------------------------------- |
| Le template n'a pas changé.                                 | Aucune action.                                            |
| Le template a changé et l'actuel égale encore la base.      | Mise à jour sur place.                                    |
| Le projet contient déjà la cible.                           | Aucune action.                                            |
| Le template et le fichier actuel ont tous deux divergé.     | Stratégie de conflit.                                     |
| La cible ajoute un chemin absent.                           | Ajout.                                                    |
| La cible ajoute un chemin occupé par d'autres octets.       | Stratégie de conflit.                                     |
| La cible retire un fichier géré encore identique à la base. | Suppression par la procédure protégée des fichiers gérés. |
| La cible retire un fichier que vous avez modifié.           | Conservation.                                             |

Les chemins inscrits dans `unmanagedPaths` restent hors de la carte de propriété. Un nouveau chemin de template ou de module déjà occupé par d'autres octets devient un conflit. Un module ajouté
tardivement est préparé hors du projet et soumis à ces contrôles avant d'enregistrer sa version ou ses dépendances.

## Stratégies de conflit

| Stratégie           | Comportement sur un fichier divergent                                     | Quand l'utiliser                                                               |
| ------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `save-new` (défaut) | Conserve votre fichier et écrit la cible dans `<chemin>.saasfoundry.new`. | Vous voulez fusionner manuellement après relecture.                            |
| `keep`              | Conserve votre fichier sans sidecar.                                      | Votre version doit rester la source de vérité.                                 |
| `replace`           | Remplace votre fichier par la cible générée.                              | Vous avez versionné ou sauvegardé l'arbre et voulez explicitement le template. |

```bash
sf update --accept-template-updates --conflict-strategy save-new
```

`--accept-template-updates` évite la confirmation interactive pour les évolutions sans conflit. Il ne transforme pas les conflits `save-new` ou `keep` en installation de module réussie : tant qu'une
collision de module subsiste, le module n'est pas versionné et ses dépendances ne sont pas rafraîchies. Résolvez les chemins puis relancez la commande.

::: danger `replace` supprime vos octets locaux

Le CLI ne crée aucune sauvegarde du fichier remplacé. Versionnez l'arbre et inspectez la prévisualisation avant de choisir `replace`.

:::

## Migrations et récupération

Une mise à jour peut combiner trois mécanismes distincts :

1. Les **migrations de manifeste** amènent les anciens schémas au format actuel.
2. Les **migrations de modules** exécutent la chaîne ordonnée de chaque module installé et n'avancent sa version qu'après succès.
3. Le **rafraîchissement du template** applique la comparaison ci-dessus ; ce n'est pas une migration de base de données de production.

### CLAUDE.md passe dans AGENTS.md (harness v4)

`AGENTS.md` est le seul fichier d'instructions que lisent tous les agents de code, Claude Code compris (2.1.277 ou plus récent). Un projet installé avant garde ses instructions dans `CLAUDE.md`, et
Claude Code ignore `AGENTS.md` tant qu'un `CLAUDE.md` existe. La migration harness v3 → v4 les déplace, section par section, à la racine et dans chaque application d'un monorepo ou multirepo :

| Section de `CLAUDE.md`                                                                                    | Destination                                                                                                  |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Vos propres sections, la section `## Workflow System`                                                     | `AGENTS.md`, à l'identique et dans le même ordre                                                             |
| Une section du template encore identique à une version livrée par SaaSFoundry                             | `AGENTS.md`, dans sa formulation actuelle, neutre vis-à-vis de l'outil                                       |
| Une section livrée que la région générée contient désormais (onboarding, capacités, éditions de fichiers) | Retirée : la région `saasfoundry:generated` en fin d'`AGENTS.md` la régénère                                 |
| Une copie modifiée de l'une de ces sections                                                               | `AGENTS.md`, à l'identique sous **Kept from CLAUDE.md for review** : reprenez ce qui sert, puis supprimez-la |
| Les notes propres à Claude (hook de session, skills `/sf-<name>`, permissions)                            | `.claude/rules/claude-code.md`, déposé quand Claude Code est déclaré                                         |

`CLAUDE.md` n'est supprimé qu'une fois `AGENTS.md` écrit et chaque section déplacée relue dedans. Si `AGENTS.md` est un fichier que vous avez écrit et non le pont généré, rien n'est écrasé : la
proposition va dans `AGENTS.md.saasfoundry.new` et les deux fichiers restent jusqu'à ce que vous les fusionniez. Un `CLAUDE.local.md` n'est jamais supprimé ; la mise à jour le signale, car tant qu'il
existe Claude Code ignore toujours `AGENTS.md`.

Les ponts générés sont reconnus à leurs octets, quelle que soit la version qui les a écrits : les v1.0.0 et v1.0.1 publiées comme le CLI actuel. Un `CLAUDE.md` qui n'est que le pont généré vers un
`AGENTS.md` est supprimé, car il cache `AGENTS.md` à Claude Code ; il n'est pas pris pour un `CLAUDE.md` que vous avez écrit, ce qui laissait votre `AGENTS.md` à côté d'un sidecar. Un `AGENTS.md` qui
n'est que le pont généré vers votre `CLAUDE.md` est remplacé, pas conservé comme un fichier à vous.

Prévisualisez d'abord : `sf update --dry-run --json` liste chaque section sous `moduleMigrations`, avec son action (`move`, `refresh`, `drop`, `keep-for-review`), sa source et sa cible.

Lorsqu'un projet `harness` reçoit le stack technique, SaaSFoundry utilise une transaction journalisée. Un prochain `sf update --target-profile full` tente d'abord une récupération sûre si un processus
s'est arrêté pendant la transition. S'il ne peut prouver ni commit complet ni retour arrière sûr, il s'arrête et signale les chemins non résolus.

Les changements de base applicative restent une opération de l'équipe. Relisez les changements Prisma ou SQL générés et utilisez les commandes du projet adaptées à l'environnement ; `sf update` ne
promet pas de migrer les données de production.

### Agents de palier

Chaque mise à jour rafraîchit les [agents de palier](/fr/cli/sf-agents#agents-de-palier) des agents de développement déclarés, à partir de la grille de routage actuelle et des surcharges `routing` du
projet : un fichier intact est réécrit, un fichier modifié reçoit un fichier `.saasfoundry.new`. Un harness géré sans liste `agents` est traité comme Claude Code et ne reçoit que les fichiers
`.claude/agents/sf-<tier>.md` ; ses autres fichiers d'instructions restent tels quels.

### Capture des délégations et permissions (harness v5)

`.claude/settings.json` est votre fichier, et `sf update` y maintient deux choses à jour à **chaque exécution**, sans question ni option (`--non-interactive` compris) :

- les **hooks** qui enregistrent chaque délégation routée dans le registre du clone (`SubagentStop` pour les agents `sf-<tier>`, `PostToolUse` sur l'outil de délégation), voir
  [capture et signaux](/fr/cli/sf-agents#capture-et-signaux) ;
- les **règles de permission** qui laissent l'agent lire une route, le consentement à déléguer et le rapport de routage sans demander, tandis que les formes qui écrivent une preuve (`--record`,
  `--retry-of`) demandent toujours.

C'est la même fusion que `sf agents refresh --scope shared` : `sf agents refresh` n'est donc plus nécessaire après une mise à jour pour cela. La migration du harness v4 → v5
(`wire-delegation-capture`) est aussi cette fusion : un harness installé par une version antérieure, v1.0.1 comprise, la reçoit à la mise à jour qui le passe en v5, avec les agents de palier et le
déplacement vers `AGENTS.md` que chaque mise à jour faisait déjà. La migration ne dépose rien d'autre, et n'écrit jamais le consentement à déléguer : seule votre propre réponse l'enregistre
(`sf agents delegation`).

| Situation                                                                                                                                                                    | Résultat                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Le fichier n'a pas les hooks ou les règles.                                                                                                                                  | Ils sont fusionnés. Vos clés, hooks et règles restent, dans leur ordre ; le résumé nomme le fichier.                                            |
| Le fichier a tout.                                                                                                                                                           | Rien n'est écrit : mêmes octets, même date de modification, rien d'affiché.                                                                     |
| Il n'y a pas de fichier.                                                                                                                                                     | Il est créé avec les hooks et les règles du harness.                                                                                            |
| Le fichier est un lien symbolique, un lien physique, ou un texte qui n'est pas un objet JSON.                                                                                | Il reste tel quel et la proposition fusionnée va dans `.claude/settings.json.saasfoundry.new` ; la mise à jour continue.                        |
| `hooks` n'est pas un objet, un événement de hook n'est pas une liste de groupes de hooks, `permissions` n'est pas un objet, ou son `allow` ou son `ask` n'est pas une liste. | Pareil : il reste tel quel et la proposition va dans le sidecar, avec la raison dans le résumé. La fusion aurait écrasé ce que vous avez écrit. |
| Le hook est la commande `sf agents outcome capture` nue qu'écrivait une première version.                                                                                    | Elle est remplacée par la commande qui résout le CLI propre au projet.                                                                          |

**Un simple `sf update` n'ajoute que.** Il ne retire jamais une règle de vos `permissions` : une règle ajoutée volontairement reste, exécution après exécution. Les seules règles que le harness retire
un jour sont les deux qu'une version de développement avait pré-approuvées, `Bash(sf agents outcome record *)` et `Bash(sf agents outcome mark *)` : elles écrivent une preuve dont le routage tient
compte, le harness les laisse donc demander. Cela se produit **une seule fois, dans la migration du harness v4 → v5, et dans `sf agents refresh`**, jamais dans la fusion de chaque mise à jour, et
chaque règle retirée est nommée dans la sortie (et dans l'aperçu de `--dry-run`).

Elle s'applique à la racine du projet, et à chaque dépôt d'application d'un projet multirepo qui a un `.claude/`. Elle ignore un harness `managed: false`, un harness dont les agents déclarés excluent
Claude Code, et une adoption en référence seule, dont les instructions demandent à l'agent de ne pas modifier réglages, hooks ni permissions.

Un projet généré part des mêmes hooks et règles : les trois templates `.claude/settings.json` du scaffold les portent. Comme la fusion possède le fichier, il ne fait plus partie de la comparaison des
templates : un changement de template ne transforme jamais un fichier déjà mis à jour par la fusion en conflit.

Prévisualisez : `sf update --dry-run` liste le fichier sous `harnessSettings` du rapport (`merged`, `created`, `sidecar`), ou dans l'aperçu de la migration `wire-delegation-capture` en attente quand
le harness est encore sous la v5.

## Ajouter des capacités après la création

Sélection interactive :

```bash
sf update
```

Prévisualisation et application scriptées :

```bash
sf update --dry-run --json --add-modules email,analytics
sf update --non-interactive --add-modules email,analytics
```

Les choix disponibles dépendent du manifeste. Le catalogue comprend e-mail, stockage, analytics, PWA, SRS, les skills outils supportés et l'alias de compatibilité du harness pour un profil `stack`. Un
module déjà installé est ignoré.

### Converger vers le profil complet

Les transitions V1 sont uniquement additives :

| Profil actuel               | `--target-profile full`                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `harness`                   | Planifie puis ajoute un stack monorepo ou multirepo si chaque chemin candidat est absent ou strictement identique. |
| `stack`                     | Ajoute le harness de développement géré. `--add-modules harness` reste l'alias compatible.                         |
| `full`                      | Réussit sans modification.                                                                                         |
| `projection` multirepo      | S'arrête et renvoie vers le coordinateur racine.                                                                   |
| `unknown` ou `inconsistent` | S'arrête avec une remédiation du manifeste.                                                                        |

La V1 ne retire pas de module, ne regroupe ni ne sépare les dépôts, ne convertit pas monorepo↔multirepo et ne quitte pas le profil `full`.

```bash
sf status --json --no-network
sf update --target-profile full --dry-run --json
sf update --target-profile full
```

Pour une transition harness → full non interactive, fournissez tous les choix techniques requis :

```bash
sf update --non-interactive \
  --target-profile full \
  --structure monorepo \
  --db-setup manual \
  --db-type postgresql \
  --email-service none \
  --s3-setup manual \
  --no-analytics \
  --pwa
```

Une collision non gérée sur un chemin technique bloque tout l'ajout initial du stack ; aucune stratégie de conflit ne force cette adoption. Les transitions de profil fonctionnent sur macOS, Linux et
Windows via WSL en V1. Windows natif s'arrête avant mutation.

## Adopter un projet bêta vérifié

Un projet généré avant les manifestes ne peut pas suivre le cycle normal sans base de confiance. La V1 supporte uniquement la sortie multirepo vérifiée du paquet publié `saasfoundry-cli@1.0.0-beta`.

Prévisualisez et récupérez l'empreinte du plan :

```bash
sf update --adopt-legacy --dry-run --json \
  --project-name mon-app \
  --main-branch main
```

Appliquez exactement ce plan relu :

```bash
sf update --adopt-legacy \
  --project-name mon-app \
  --main-branch main \
  --adopt-plan <empreinte>
```

L'adoption vérifie la structure historique et les octets inspectés, puis écrit uniquement `.saasfoundry.json`. Elle ne remplace jamais un manifeste existant. Toute modification inspectée invalide
l'empreinte. Les options d'adoption ne se combinent pas avec les options modules, workflow, stack, SRS ou secrets ; lancez ensuite une mise à jour normale.

La bêta publiée ne générait pas de monorepo : les reconstructions synthétiques d'un monorepo bêta ne sont pas éligibles.

## Automatisation et secrets

Gardez les secrets hors des commandes générées et de l'historique shell. Les variables disponibles à l'application comprennent :

| Secret               | Variable d'environnement        |
| -------------------- | ------------------------------- |
| Mot de passe de base | `SF_UPDATE_DB_PASSWORD`         |
| Clé API MailerSend   | `SF_UPDATE_MAILERSEND_API_KEY`  |
| Clé d'accès S3       | `SF_UPDATE_S3_ACCESS_KEY`       |
| Secret S3            | `SF_UPDATE_S3_SECRET_KEY`       |
| Clé Context7         | `SF_UPDATE_CONTEXT7_API_KEY`    |
| Jeton Atlassian      | `SF_UPDATE_ATLASSIAN_API_TOKEN` |
| Jeton Notion         | `SF_UPDATE_NOTION_API_TOKEN`    |
| Jeton Figma          | `SF_UPDATE_FIGMA_API_TOKEN`     |

Exemple :

```bash
SF_UPDATE_MAILERSEND_API_KEY="$MAILERSEND_KEY" \
  sf update --non-interactive \
  --add-modules email \
  --accept-template-updates
```

## Checklist de récupération

Avant une mise à jour importante :

```bash
git status
sf status --agent-friendly --no-network
sf update --dry-run --json > plan-mise-a-jour-saasfoundry.json
```

Puis :

1. Versionnez ou sauvegardez l'arbre actuel.
2. Relisez le rapport et résolvez ses blocages.
3. Appliquez avec `save-new` sauf si un écrasement est intentionnel.
4. Inspectez `git diff` et chaque sidecar `.saasfoundry.new`.
5. Fusionnez ou écartez chaque sidecar explicitement, puis supprimez-le.
6. Lancez le build, le lint, les tests et la procédure de base requise par le projet généré.
7. Versionnez ensemble les fichiers mis à jour et `.saasfoundry.json`.

Si la commande échoue, suivez son message de récupération et relancez la même commande après correction. Ne supprimez pas les journaux de transition et ne réécrivez pas les empreintes de propriété
manuellement.

## Options

| Option                                                              | Description                                                            | Défaut      |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------- |
| `--non-interactive`                                                 | Échouer si une valeur obligatoire manque, sans poser de question.      | -           |
| `--dry-run`                                                         | Prévisualiser sans écrire ni lancer d'installateur.                    | -           |
| `--json`                                                            | Avec `--dry-run`, produire un objet JSON versionné sur stdout.         | -           |
| `--target-profile <profile>`                                        | Ajouter la capacité manquante pour atteindre `full` ; seule valeur V1. | -           |
| `--project-description <text>`                                      | Description utilisée lorsqu'un harness ajoute le stack.                | dérivée     |
| `--structure <structure>`                                           | `monorepo` ou `multirepo` pour harness → full.                         | -           |
| `--db-setup <setup>`                                                | `docker`, `credentials` ou `manual`.                                   | -           |
| `--db-type <type>`                                                  | `postgresql` ou `sql`.                                                 | -           |
| `--db-host`, `--db-port`, `--db-user`, `--db-password`, `--db-name` | Choix de base avec identifiants.                                       | -           |
| `--api-port`, `--web-port`                                          | Ports hôte API et web explicites.                                      | automatique |
| `--email-service <service>`                                         | `none` ou `mailersend`.                                                | -           |
| `--analytics` / `--no-analytics`                                    | Inclure ou ignorer Analytics dans un nouveau stack.                    | -           |
| `--pwa` / `--no-pwa`                                                | Inclure ou ignorer le support PWA.                                     | -           |
| `--accept-template-updates`                                         | Appliquer les évolutions sans conflit sans confirmation.               | -           |
| `--conflict-strategy <strategy>`                                    | `keep`, `replace` ou `save-new`.                                       | `save-new`  |
| `--add-modules <modules>`                                           | Modules à ajouter, séparés par des virgules.                           | -           |
| `--workflow <preset>` / `--no-workflow`                             | Configurer `solo`, `saasfoundry`, `none`, ou aucun workflow.           | -           |
| `--adopt-legacy`                                                    | Inspecter ou adopter un multirepo bêta vérifié.                        | -           |
| `--adopt-plan <fingerprint>`                                        | Appliquer le plan d'adoption exact déjà relu.                          | -           |
| `--project-name <name>`                                             | Nom généré d'origine pour la vérification historique.                  | dossier     |
| `--main-branch <branch>`                                            | Branche historique commune si elle n'est pas prouvée automatiquement.  | détectée    |
| `--s3-setup <setup>`                                                | Mode de stockage pour une transition ou un ajout compatible.           | -           |
| `--srs-backend <backend>`                                           | Backend SRS ; la V1 supporte `notion`.                                 | -           |
| `--srs-parent-page-input <url>`                                     | URL ou ID de la page racine SRS.                                       | -           |

Des options supplémentaires existent pour les secrets et intégrations des modules activés. Utilisez `sf update --help` pour la liste exhaustive actuelle.

## Poursuivre le cycle

- [Comprendre le modèle de mise à jour complet](/fr/guide/updating-projects)
- [Inspecter l'état du projet](/fr/cli/sf-status)
- [Comparer monorepo et multirepo](/fr/guide/monorepo-vs-multirepo)
- [Comprendre le cycle SRS](/fr/srs/lifecycle)
