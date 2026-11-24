# sf new

Transformez vos choix en projet géré. `sf new` crée un projet SaaSFoundryAI et le contrat qui permettra au CLI et aux agents de code de le faire évoluer sans perdre vos changements. Utilisez
l'assistant interactif pour un premier projet, ou fournissez les mêmes choix par options dans une automatisation.

```bash
sf new [options]
```

## Le cycle de création

| Étape                              | Ce qui se passe                                                                                               | Ce que vous obtenez                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **1. Choisir un profil**           | Sélectionnez l'architecture SaaS, le harness de développement, ou les deux.                                   | Seules les questions utiles sont posées.                       |
| **2. Décrire le projet**           | Choisissez le nom, la topologie, les dépôts, les ports et les services optionnels.                            | Un plan de génération complet et validé.                       |
| **3. Configurer la collaboration** | Sélectionnez les hôtes d'agents, le workflow, les outils et éventuellement le SRS.                            | Des instructions et skills partagés pour les hôtes choisis.    |
| **4. Générer**                     | SaaSFoundry produit les fichiers, initialise les dépôts demandés et peut lancer les services locaux.          | Un projet fonctionnel ou un harness ajouté.                    |
| **5. Enregistrer le contrat**      | Le CLI écrit `.saasfoundry.json` avec les choix, capacités, versions, ports et empreintes des fichiers gérés. | Les prochains `sf status` et `sf update` n'ont rien à deviner. |

Le manifeste est une métadonnée partagée du projet. Versionnez-le : le CLI le lit pour reproduire l'architecture choisie ; le harness l'utilise pour comprendre le workflow, les outils, le backend SRS
et les frontières entre dépôts.

## Choisir ce que SaaSFoundry gère

`--profile` est le premier choix, car il détermine la suite du parcours.

| Profil    | Installe                                                                        | Cas d'usage                                                                                     |
| --------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `full`    | Architecture SaaS **et** harness de développement                               | Un nouveau produit construit et livré avec SaaSFoundryAI. C'est le profil par défaut.           |
| `stack`   | Socle technique et dépôts utilitaires, sans workflow ni SRS gérés               | Vous voulez l'architecture SaaS préconçue avec un autre processus de livraison.                 |
| `harness` | Workflow, skills, points d'entrée agents et SRS optionnel dans le dépôt courant | Vous avez déjà une application et voulez le système de développement sans remplacer le produit. |

`harness` ne crée aucun dossier de projet et ne superpose pas l'architecture SaaS. Lancez-le à la racine du dépôt existant. Les questions propres au stack — base de données, stockage, e-mail, PWA —
sont ignorées.

En mode non interactif, le profil reste `full` par défaut pour préserver les scripts existants.

## Parcours interactif

Lancez l'assistant :

```bash
sf new
```

Les questions sont conditionnelles. Un projet `full` configure l'architecture technique et le harness ; `stack` ignore les questions agents/workflow ; `harness` ignore les questions liées au stack
produit. Le CLI valide les combinaisons requises avant de générer quoi que ce soit.

Pour `full` et `harness`, les identifiants d'hôtes supportés sont `claude-code`, `codex`, `kimi`, `gemini-cli`, `qwen-code` et `generic`. Ils désignent l'intégration hôte, pas le fournisseur du
modèle. Les identifiants et le routage des modèles restent dans la configuration de chaque développeur.

::: tip CLI ou assistant ?

L'installation guidée par un assistant utilise le même générateur et le même contrat de manifeste. Choisissez l'interface qui vous convient : le projet reste compatible avec le même cycle `sf status`
et `sf update`. Consultez [Installation par CLI ou assistant](/fr/getting-started/setup-paths).

:::

## Topologie des dépôts

Les deux topologies applicatives sont supportées :

- **Monorepo :** API, application web, harness et manifeste racine vivent dans un même dépôt.
- **Multirepo :** le coordinateur référence les dépôts API et web générés ; chaque dépôt applicatif reçoit les points d'entrée du harness dont il a besoin.

La topologie modifie les frontières de dépôt, pas les capacités du produit. Comparez [monorepo et multirepo](/fr/guide/monorepo-vs-multirepo) avant de choisir. `sf update` peut ajouter plus tard une
capacité manquante, mais la V1 ne convertit pas une topologie dans l'autre.

## Ce que `sf new` versionne

`sf new` fait le premier commit de chaque dépôt qu'il crée, en toute dernière étape : le socle, le harness, les instructions d'agents et `.saasfoundry.json` sont alors tous écrits, et le dépôt démarre
sur un seul commit racine avec un `git status` propre.

| Cas                                 | Ce qui est versionné                                                                                                                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Monorepo                            | Un commit racine dans le dossier du projet, sur la branche principale, avec le manifeste et le harness.                                                                                                |
| Multirepo                           | Un commit racine dans chaque dépôt applicatif (`apps/<nom>-api`, `apps/<nom>-web`), chacun avec son propre manifeste et son harness. Le dossier du projet n'est pas un dépôt et ne porte aucun commit. |
| `--setup-repo local`                | Le commit seul. Il n'y a pas encore de dépôt distant.                                                                                                                                                  |
| `--setup-repo existing`             | Le même commit, et l'URL fournie est ajoutée comme `origin`. Rien n'est poussé : poussez vous-même la branche principale.                                                                              |
| `--workflow <preset>` (un workflow) | Aucun commit : c'est le workflow qui le fait. Voir ci-dessous.                                                                                                                                         |
| `--profile harness`                 | Aucun commit. Le harness arrive dans votre dépôt existant ; versionnez-le avec votre propre travail.                                                                                                   |

Le message du commit est `Initial commit`. Il n'exécute pas les hooks Git du projet : Husky les installe depuis le script `prepare` de `npm install`, que `sf new` lance avant que le dépôt existe ; ils
sont donc installés par votre prochain `npm install` (ou `npx husky`) et s'appliquent dès votre deuxième commit. Les fichiers générés après le commit, comme les migrations créées par
`--start-services`, n'en font pas partie.

Si le commit ne peut pas être fait (pas de `user.name` ou `user.email`, un hook qui vous est propre), `sf new` va quand même au bout, le dit dans son récapitulatif et nomme le commit à faire à la
main.

### Avec un workflow : le premier ticket fait le premier commit

Le format de commit d'un workflow exige un ticket (`type(#N): description`), et un projet qui vient d'être généré n'en a pas. `workflow-cli.sh bootstrap` existe pour ce moment : sur un dépôt vide, il
versionne tout sous `chore(#N): bootstrap the repository`, pousse les branches principale et de travail, et ferme le ticket `N`. Il refuse un dépôt dont le commit racine est autre chose : un
`Initial commit` fait par `sf new` l'aurait rendu inutilisable.

Quand vous passez `--workflow`, `sf new` laisse donc chaque dépôt sur sa branche principale, sans commit, et le récapitulatif comme `sf status` nomment l'étape suivante :

```bash
.claude/skills/sf-workflow/workflow-cli.sh create-ticket task "Bootstrap the repository" --complexity low
.claude/skills/sf-workflow/workflow-cli.sh bootstrap <ticket>
```

`bootstrap` exige un dépôt distant `origin` : passez `--setup-repo existing` avec l'URL du dépôt, ou ajoutez-le avant avec `git remote add origin <url>`. Sur un projet multirepo, lancez-le dans chaque
dépôt applicatif.

## La frontière de propriété

SaaSFoundry enregistre les empreintes des fichiers qu'il a générés et qu'il gère encore. Elles forment la **base** de la prochaine comparaison à trois voies :

```text
base enregistrée + projet actuel + template actuel = plan de mise à jour sûr
```

- Les fichiers gérés peuvent recevoir les évolutions du template qui n'entrent pas en conflit.
- Un fichier que vous modifiez est détecté comme divergent ; par défaut, la mise à jour le préserve et écrit le nouveau template à côté.
- Les chemins inscrits dans `unmanagedPaths` restent hors de la frontière de propriété du template.
- Un nouveau chemin de template déjà occupé par d'autres octets devient un conflit au lieu d'être écrasé silencieusement.

C'est pourquoi `.saasfoundry.json` doit être versionné. Sa carte de propriété fait foi : inspectez-la lors d'une adoption ou d'une restructuration et ne modifiez pas les empreintes à la main pour
masquer un conflit. Résolvez les fichiers et laissez `sf update` enregistrer la prochaine base vérifiée.

## Ports

Les ports locaux par défaut avancent automatiquement lorsqu'ils sont déjà occupés :

| Service    | Port par défaut | Comportement automatique        |
| ---------- | --------------: | ------------------------------- |
| PostgreSQL |          `5435` | Utilise le prochain port libre. |
| API        |          `3500` | Utilise le prochain port libre. |
| Web        |          `5173` | Utilise le prochain port libre. |

Les services qu'un module héberge dans Docker suivent la même règle et n'existent que si le module est installé : MinIO (`9000` et console `9001`, avec `--s3-setup docker`) et la boîte Mailpit du
[module email](/fr/modules/email) (`8025`, enregistré comme `ports.mail`).

Un port demandé explicitement n'est jamais déplacé silencieusement. Si `--api-port 3500` est demandé mais indisponible, la génération s'arrête et décrit le conflit. Pour une base en mode `credentials`
ou `manual`, le port désigne un service externe et reste inchangé.

Les ports résolus sont enregistrés sous `ports` dans `.saasfoundry.json`, puis réutilisés dans les fichiers d'environnement, Compose, Vite et la documentation générée.

## Exemples scriptés

Créer un monorepo complet pour deux hôtes d'agents :

```bash
sf new --non-interactive \
  --profile full \
  --project-name mon-saas \
  --agents claude-code,codex \
  --structure monorepo \
  --setup-repo local \
  --db-setup docker \
  --db-type postgresql \
  --email-service none \
  --no-analytics \
  --start-services \
  --start-apps all
```

Créer le même produit avec des dépôts applicatifs séparés :

```bash
sf new --non-interactive \
  --profile full \
  --project-name mon-saas \
  --agents codex \
  --structure multirepo \
  --setup-repo existing \
  --backend-repo-url git@github.com:acme/mon-saas-api.git \
  --frontend-repo-url git@github.com:acme/mon-saas-web.git \
  --db-setup docker \
  --db-type postgresql \
  --email-service none \
  --no-analytics \
  --start-apps none
```

Ajouter uniquement le harness au dépôt courant :

```bash
sf new --profile harness --agents codex,claude-code
```

Activer le SRS avec son backend Notion actuellement supporté :

```bash
sf new --non-interactive \
  --project-name mon-saas \
  --structure monorepo \
  --setup-repo local \
  --db-setup docker \
  --db-type postgresql \
  --email-service none \
  --no-analytics \
  --advanced-skills notion \
  --srs-enable \
  --srs-backend notion \
  --srs-parent-page-input "https://www.notion.so/votre-espace/racine-SRS-abc123"
```

## Vérifier le résultat

Depuis la racine du projet généré :

```bash
sf status --agent-friendly --no-network
git status
```

La première commande rapporte le profil effectif, la topologie, les modules, les outils et les problèmes de configuration actionnables, sans contacter de service externe. Sans workflow, `git status`
est propre : les fichiers générés, y compris `.saasfoundry.json`, sont [déjà versionnés](#ce-que-sf-new-versionne). Avec un workflow, le dépôt n'a pas encore de commit et `sf status` renvoie vers
`bootstrap`.

Pour le démarrage local, suivez le README généré : les commandes dépendent de la topologie et des services choisis.

## Options

| Option                                           | Description                                                                                                                         | Défaut                |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `--profile <profile>`                            | Installer `full`, `harness` ou `stack`.                                                                                             | `full`                |
| `--agents <agents>`                              | Identifiants d'hôtes d'agents séparés par des virgules.                                                                             | Claude historique¹    |
| `--non-interactive`                              | Échouer si une valeur obligatoire manque, sans poser de question.                                                                   | -                     |
| `--project-name <name>`                          | Nom du projet en kebab-case.                                                                                                        | -                     |
| `--project-description <description>`            | Description du produit.                                                                                                             | -                     |
| `--structure <structure>`                        | `monorepo` ou `multirepo`.                                                                                                          | -                     |
| `--main-branch <branch>`                         | `main` ou `master`.                                                                                                                 | -                     |
| `--setup-repo <setup>`                           | `local` ou `existing`.                                                                                                              | -                     |
| `--monorepo-url <url>`                           | URL d'un monorepo existant.                                                                                                         | -                     |
| `--backend-repo-url <url>`                       | URL du dépôt API en multirepo.                                                                                                      | -                     |
| `--frontend-repo-url <url>`                      | URL du dépôt web en multirepo.                                                                                                      | -                     |
| `--db-setup <setup>`                             | `docker`, `credentials` ou `manual`.                                                                                                | -                     |
| `--db-type <type>`                               | `postgresql` ou `sql`.                                                                                                              | -                     |
| `--db-port <port>`                               | Port hôte de la base.                                                                                                               | `5435`                |
| `--api-port <port>`                              | Port hôte de l'API.                                                                                                                 | `3500`                |
| `--web-port <port>`                              | Port hôte du web.                                                                                                                   | `5173`                |
| `--email-service <service>`                      | `none` ou `mailersend`.                                                                                                             | -                     |
| `--s3-setup <setup>`                             | `docker`, `credentials` ou `manual`.                                                                                                | -                     |
| `--analytics` / `--no-analytics`                 | Inclure ou ignorer Analytics.                                                                                                       | -                     |
| `--pwa` / `--no-pwa`                             | Inclure ou ignorer le support installable.                                                                                          | actif                 |
| `--advanced-skills <skills>`                     | Liste parmi `context7,atlassian,notion,figma`.                                                                                      | -                     |
| `--srs-enable` / `--no-srs-enable`               | Activer ou ignorer le [module SRS](/fr/modules/srs).                                                                                | -                     |
| `--srs-backend <backend>`                        | Backend SRS ; la V1 supporte `notion`.                                                                                              | -                     |
| `--srs-parent-page-input <url>`                  | URL ou ID de la page racine SRS.                                                                                                    | -                     |
| `--srs-ingest-enable` / `--no-srs-ingest-enable` | Configurer l'ingestion ponctuelle de notes existantes.                                                                              | -                     |
| `--srs-ingest-parent-input <url>`                | Page source à ingérer.                                                                                                              | -                     |
| `--workflow <config>` / `--no-workflow`          | Choisir un preset, `none`, ou ne pas configurer de workflow.                                                                        | -                     |
| `--working-branch <branch>`                      | Branche de travail : les branches de ticket en partent et les pull requests la visent. Exige `--workflow` avec `--non-interactive`. | `develop`             |
| `--pr-target-branch <branch>`                    | Branche visée par les pull requests, si elle diffère de la branche de travail.                                                      | la branche de travail |
| `--project-url <url>`                            | Rattacher un board existant (GitHub Projects, Jira, Notion ou Linear). Exige `--workflow` avec `--non-interactive`.                 | -                     |
| `--create-board`                                 | Créer le board GitHub Projects sous le compte du remote `origin`, sans question. Exclusif avec `--project-url`.                     | -                     |
| `--start-services` / `--no-start-services`       | Lancer ou ignorer la base et le stockage locaux.                                                                                    | -                     |
| `--start-apps <mode>`                            | Lancer `all`, `backend`, `frontend` ou `none`.                                                                                      | -                     |

¹ Repli de compatibilité lorsque `--agents` est absent. Une sélection explicite est stockée dans `modules.harness.agents`.

Des options de secrets existent pour la base sélectionnée, MailerSend, le stockage et les intégrations d'outils. Utilisez `sf new --help` pour la liste exhaustive actuelle ; les options ne sont
validées que lorsque leur module est concerné.

Pour configurer le SRS Notion, fournissez `NOTION_API_TOKEN` via l'environnement. L'ancien flag `--notion-api-token` reste disponible, mais expose le jeton dans les arguments du processus.

## Poursuivre le cycle

- [Comprendre l'architecture générée](/fr/guide/project-structure)
- [Comparer monorepo et multirepo](/fr/guide/monorepo-vs-multirepo)
- [Livrer le premier ticket](/fr/getting-started/shipping-first-ticket)
- [Prévisualiser et appliquer les mises à jour](/fr/cli/sf-update)
