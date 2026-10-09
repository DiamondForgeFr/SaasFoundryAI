# Changelog

Toutes les évolutions notables de SaaSFoundryAI sont consignées ici.

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le projet applique le [versionnage sémantique](https://semver.org/lang/fr/).

## [Non publié]

## [1.0.1] - 2026-10-09

Version de maintenance. Elle corrige ce que des projets réels ont rencontré après la 1.0.0 : `sf update` sur des projets personnalisés, l'installation non interactive du harness, l'écriture et le
spawn du SRS, les garde-fous du workflow, ainsi que les fichiers Docker, CI et de déploiement générés.

### Ajouts

#### CLI

- `sf new` et `sf workflow use` acceptent `--project-url <url>` pour rattacher un tableau GitHub Projects existant et `--create-board` pour en créer un sous le propriétaire du remote du dépôt, sans
  question. Un workflow laissé sans tableau est signalé avec la commande exacte pour y remédier ([#821](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/821)).
- `sf new` accepte `--working-branch` et `--pr-target-branch` (`develop` par défaut), `sf workflow` gagne `set-pr-target-branch`, et l'installation indique la branche de travail créée, ou la prochaine
  étape lorsqu'elle n'existe pas encore ([#822](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/822)).
- Le jeton Notion de l'installation non interactive peut venir de la variable d'environnement `NOTION_API_TOKEN` ou d'un compte enregistré avec `sf tools`, si bien que le secret n'a plus à figurer sur
  la ligne de commande ([#823](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/823)).
- `sf --version` et `sf update` signalent que `sf` s'exécute depuis une copie de développement, et `sf update --dry-run --json` expose `cliChannel` : deux machines ne planifient plus des mises à jour
  différentes sans aucun indice ([#859](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/859)).

#### Workflow

- `workflow-cli.sh bootstrap <ticket>` conduit un dépôt vide à travers son premier ticket : il crée le commit racine sur la branche principale, crée la branche de travail, consigne l'exception sur le
  ticket et le passe à Done, sans variable de contournement ([#833](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/833)).
- `github-projects-cli.sh create-ticket <story|task|issue> <title>` crée un ticket de premier niveau dans le tableau, en Backlog, avec son type, sa complexité, sa nature et son jalon
  ([#832](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/832)).
- Contrôle de CI locale : un projet déclare dans `workflow.localCi.requiredStatuses` les statuts de commit que publie sa CI locale. `create-pr` (sans `--draft`) et `ready-pr` refusent un commit de
  tête où l'un d'eux manque ou est rouge, et `--skip-local-ci "<reason>"` est l'échappatoire explicite, consignée ([#918](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/918)).
- `workflow-cli.sh ai-status <ticket> <step> <pending|success|failure> "<description>"` affiche l'avancement de `AI testing` sur la pull request du ticket, sous forme de statut de commit et d'un
  unique commentaire de progression ([#883](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/883)).
- Le moteur de jalons propose une version composée de plusieurs Epics comme un seul candidat `epic-union`, réuni uniquement par des liens que le tableau peut vérifier, avec les preuves conservées par
  Epic ([#561](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/561)).

#### SRS

- `sf srs next-ids --feature <page-url-or-id>` affiche le prochain numéro de version et les identifiants d'exigences libres d'une fonctionnalité
  ([#919](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/919)).
- `sf srs apply-update` prend en charge `add-nfr` ([#917](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/917)).
- `sf srs validate --spec <file>` vérifie une spécification hors ligne, avant l'écriture de toute page ([#877](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/877)).
- Une exigence fonctionnelle peut indiquer sa `complexity`, et `sf srs spawn --complexity <level>` étiquette les Stories dont l'exigence n'en indique aucune
  ([#901](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/901)).

#### Compétences et harness

- `sf new` et `sf update` ajoutent à `.claude/settings.json` une liste `permissions.allow` pour les commandes en lecture seule du harness, afin que les étapes du workflow ne demandent plus
  d'autorisation. Les instructions générées demandent aussi aux agents de modifier les fichiers avec les outils de fichiers natifs plutôt qu'avec des heredocs d'interpréteur
  ([#947](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/947)).

### Corrections

#### CLI : `sf new` et création du tableau

- `sf new --workflow <valeur inconnue>` est refusé avant toute question et liste les presets valides, au lieu d'abandonner la valeur en silence
  ([#895](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/895)).
- `--no-workflow` et `--workflow none` ignorent désormais l'étape workflow d'un `sf new` interactif ([#896](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/896)).
- Un `sf new` interactif prend `--tracker`, `--docs` et `--design` comme réponses, `none` compris, et ne repose plus la question ([#914](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/914)).
- Un nom de projet contenant une apostrophe ou un guillemet ne casse plus la création du projet GitHub ([#897](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/897)).
- Une machine sans `gh` est invitée à l'installer, et non à lancer `gh auth login` ([#898](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/898)).
- Les tableaux créés automatiquement sur un compte personnel reçoivent leur vue Board, au lieu de se terminer par « Could not add the Board view »
  ([#913](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/913)).
- Le récapitulatif de documentation de `sf new` n'affiche plus de puce au libellé vide ([#890](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/890)).
- `sf srs spawn --version` est transmis au spawner ; auparavant, l'option globale `--version` l'absorbait, affichait la version de la CLI et sortait avec le code 0 sans rien créer
  ([#834](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/834)).
- `sf status` nomme la branche d'un dépôt sans commit (`main (no commits yet)`) au lieu d'afficher « detached » ou « Branch unknown »
  ([#825](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/825)).
- `sf workflow validate` exécute directement la vérification du manifeste et indique un remède pour chaque problème, au lieu de signaler une compétence de validation qu'aucune version ne fournit
  ([#824](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/824)).
- Les guides du harness indiquent les vrais prérequis : Node 22 et npm 10 pour la CLI, Node 24 et npm 11 pour la pile générée ([#826](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/826)).

#### CLI : `sf update`

- Une mise à jour qui se termine avec des conflits atteint désormais la nouvelle version : fusionner ou écarter les fichiers `.saasfoundry.new` suffit à tout résoudre et l'exécution suivante ne
  signale rien, au lieu d'entrer de nouveau en conflit sur chaque modification locale conservée ([#856](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/856)).
- Les personnalisations ne sont plus écrasées par la mise à jour suivante : les références sont enregistrées à partir de ce que la CLI a généré, et non d'un balayage des fichiers du projet, si bien
  que les sources du projet ne deviennent plus des templates suivis ([#879](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/879)).
- Le code généré (clients orval, `openapi.json`, modèles Prisma générés) n'est plus suivi comme un template : il cesse d'entrer en conflit à chaque mise à jour et n'est plus supprimé
  ([#874](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/874)).
- `sf update` ne supprime plus les scripts de la compétence `sf-srs` d'un projet full-stack avec SRS ([#857](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/857)).
- Les fichiers de template que la nouvelle CLI ne génère plus sont de nouveau supprimés lorsqu'ils sont intacts, et figurent dans le plan, le rapport de dry-run et le récapitulatif ; un fichier
  modifié n'est jamais supprimé ([#865](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/865)). Un fichier obsolète conservé reste suivi : activer plus tard le module qui le génère à nouveau ne
  s'arrête plus dessus ([#882](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/882)).
- La migration du manifeste réécrit les motifs de branche `feature/{name}` et `fix/{name}` pour qu'ils nomment le ticket, ce qui corrige le refus de `In review` et `Done` sur les projets migrés ; les
  garde-fous indiquent désormais lorsqu'aucun motif configuré ne peut identifier un ticket ([#864](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/864)).
- Le package npm publié embarque désormais les trois templates `.gitignore` : `sf new` ne génère plus de projet sans `.gitignore` et `sf update` n'en supprime plus
  ([#875](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/875)).
- Les `package.json` régénérés conservent leur description et ne pointent plus vers le dépôt de la CLI ([#858](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/858)).
- Un monorepo ne conserve plus un second `.claude/` dans chaque application avec un hook `SessionStart` en double ; la migration du harness supprime la copie lorsqu'elle est intacte et signale tout
  fichier que vous avez modifié ([#425](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/425)).

#### Workflow : garde-fous, pull requests, jalons

- Le garde-fou de complexité accepte une étiquette `srs:drafting`, `srs:update` ou `srs:new` : les tickets de rédaction SRS peuvent passer en `In progress` sans étiquette de complexité arbitraire
  ([#851](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/851)), et il ne bloque plus les changements de statut des Epics ([#839](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/839)).
- La remontée de statut des Epics suit les statuts du workflow du projet : un Epic Solo passe directement à `In progress` au lieu d'échouer sur un statut `Ready` qu'il n'a pas
  ([#838](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/838)).
- Passer un ticket à `Done` ferme son issue GitHub lorsque l'automatisation du tableau ne l'a pas fait, et échoue en nommant l'issue si elle reste ouverte ; cela couvre les tickets de rédaction fermés
  par `transition-drafting done` ([#920](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/920)).
- Les scripts du workflow épinglent `gh` sur le dépôt `origin` : un remote `upstream` dans un fork ne redirige plus les commandes de ticket et de pull request vers le projet d'origine ; `sf status`
  signale lorsqu'un appel `gh` nu viserait un autre dépôt que `origin` ([#840](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/840)).
- Dans le workflow Solo, la fusion d'une pull request dans la branche de travail passe désormais son ticket à `Done` et ferme l'issue, comme l'annonce la bannière de `In review`
  ([#845](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/845)).
- `pr-review-sync` réagit aussi aux pull requests ouvertes directement prêtes pour la revue : `create-pr` sans `--draft` ne laisse plus le ticket en `AI testing`
  ([#876](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/876)), et un événement refusé nomme désormais la première condition non satisfaite, comme une ligne `Resolves #N` absente
  ([#846](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/846)).
- `milestone assign` accepte un seul numéro d'issue et n'affiche un succès que pour ce que GitHub confirme, au lieu de traiter le premier numéro d'une liste et de les déclarer tous
  ([#562](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/562)).
- `create-subtask` place l'enfant sur le jalon de son parent, ou sur celui que nomme `--milestone`, et l'indique ([#617](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/617)).
- Le moteur de jalons voit un Epic terminé et nomme chaque Epic qu'il écarte : une version ne disparaît plus au moment où elle est prête à être livrée
  ([#560](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/560)).

#### SRS : `sf srs write`, `spawn`, `apply-update`

- `sf srs write` et les autres actions SRS refusent une option inconnue avec le code de sortie 2 avant toute écriture ; `--dry-run`, qui n'existe pas, était ignoré et créait un arbre complet en double
  ([#877](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/877)).
- Les champs `businessValue` et `scope` d'une fonctionnalité sont affichés sur sa page ([#843](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/843)).
- La page de fonctionnalité montre les descriptions des DS et liste les FR liées à chaque UR ([#850](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/850)).
- Une nouvelle version peut être écrite sous une fonctionnalité créée dans un lot précédent, en nommant la page de la fonctionnalité dans `epic.parentId`
  ([#899](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/899)).
- Les éléments UR, DS, TC et NFR portés par les candidats FR et les versions sont listés dans les tableaux de la fonctionnalité, au lieu d'être abandonnés en silence
  ([#900](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/900)).
- Une FR ajoutée à une version existante apparaît dans le tableau des FR et la liste des changements de la version, ainsi que dans les tableaux de la fonctionnalité ; `apply-update` place ses ajouts
  dans ces tableaux plutôt que sous des titres « Added … » ([#917](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/917)).
- Un titre de version ou un identifiant d'exigence qui existe déjà sous la fonctionnalité est refusé avant toute écriture : deux sessions ne produisent plus de versions ni d'identifiants en double
  ([#919](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/919)).
- Une FR dont les critères d'acceptation dépassent la limite de 2000 caractères de Notion dans une cellule de tableau est écrite, répartie sur plusieurs objets texte
  ([#916](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/916)).
- `sf srs spawn` ajoute l'Epic et les Stories au tableau du projet en Backlog ([#836](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/836)), remplit leur corps à partir des pages FR et version
  : exigences utilisateur, critères d'acceptation, valeur métier, périmètre ([#837](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/837)), et étiquette les Stories avec la complexité indiquée
  par leur FR ([#901](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/901)).
- `spawn --reconciliation-plan` fonctionne lorsque spawn crée lui-même l'Epic de version, et l'Epic possède les Stories à la place du ticket de rédaction
  ([#855](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/855)).
- `transition-drafting <N> ai-draft` n'échoue plus dans tous les projets : il affiche la procédure de rédaction, ou écrit une spécification rédigée avec `--spec <file>`
  ([#849](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/849)).
- `srs-cli.sh` trouve une CLI installée globalement (`npm i -g saasfoundryai-cli`) ([#835](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/835)).

#### Compétences et harness

- La projection `.agents` des compétences ne corrompt plus le code en ligne qui se termine par `!` ([#903](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/903)).
- Codex reçoit les compétences partagées complètes, y compris `sf-srs` et les documents de statuts du workflow ([#828](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/828)).
- `sf-srs`, `sf-workflow`, `sf-tool-github-projects` et les compétences d'outils Jira, Linear et Notion déclarent une description dans leur frontmatter : les agents les découvrent par leurs mots-clés
  de déclenchement ([#829](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/829)).
- Un harness sans SRS n'enregistre plus le hook `UserPromptSubmit` qui pointe vers un script absent ([#827](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/827)), et n'installe plus
  `sf-integration-rules`, qui vise la pile NestJS/React générée ([#831](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/831)).
- `sf-git-commit` et `sf-git-fix-pr-comments` commitent dans le format que déclare le manifeste (`workflow.commitFormat`) ([#830](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/830)) ;
  `sf-git-create-pr` cible `workflow.prTargetBranch`, `sf-utils-fix-errors` ne parle plus de pnpm, et `sf-git-merge` se limite au rebase de la branche du ticket
  ([#430](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/430)).
- Les templates `.claude/README.md` et `CLAUDE.md` ne listent que des compétences qui existent ([#425](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/425)).
- `sf-integration-rules` documente les portées RBAC v2, les routes d'administration et le tableau « appel direct ou enveloppe » des hooks
  ([#432](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/432)).
- La compétence d'outil Figma ne livre plus d'identifiants privés d'équipe et de projet, et l'installateur de `sf-srs` avertit lorsqu'un script ne peut pas être rendu exécutable
  ([#433](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/433)).
- `read-project.sh` de la compétence `sf-tool-saasfoundry` fonctionne de nouveau avec le catalogue renvoyé par `sf modules list --json`
  ([#866](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/866)).

#### Application générée : Docker, CI, déploiement, marque

- Les Dockerfiles de production et le déploiement générés fonctionnent : génération Prisma avec le schéma multi-fichiers, packages du workspace copiés, bon chemin de démarrage, health checks
  opérationnels, répertoire de logs accessible en écriture, nginx qui suit les redéploiements de l'API, et workflows de déploiement qui ne ciblent plus un NAS Synology
  ([#861](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/861)).
- Les Dockerfiles se construisent avec la version de Node que déclare `.nvmrc` : `npm ci` n'échoue plus sur l'exigence npm 11 pendant `docker build`
  ([#860](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/860)).
- Les workflows de déploiement attendent les tests du commit poussé et ne déploient que s'ils réussissent ([#889](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/889)).
- Un déploiement monorepo reçoit désormais la configuration MailerSend dans le `.env` du serveur ([#888](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/888)).
- Les applications générées nomment le projet, et non SaaSFoundryAI, dans leurs e-mails, l'onglet du navigateur, l'en-tête et le logo provisoire, via `APP_NAME` et `VITE_APP_NAME`
  ([#886](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/886)), ainsi que dans le titre, la description et le contact OpenAPI, qui ne portent plus l'adresse de l'auteur de la CLI
  ([#884](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/884)).
- `@prisma/adapter-pg` est aligné sur `prisma` et `@prisma/client` ([#862](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/862)).
- Avec le module de stockage, le fichier généré `organization.service.spec.ts` passe le lint du projet ([#863](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/863)).
- Le contrôle de CI obligatoire généré est exposé dès le début d'une exécution : le succès d'une exécution en brouillon ne satisfait plus un ruleset pendant que l'exécution « prête » est encore en
  validation ([#847](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/847)).
- Les workflows générés utilisent des versions d'actions sur Node.js 24, épinglées par commit, ce qui met fin aux avertissements de dépréciation
  ([#848](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/848)).
- La validation d'impact générée passe son propre contrôle de format et n'exécute plus la suite de bout en bout à presque chaque commit
  ([#867](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/867)).

#### Outillage

- La validation des commits du dépôt de la CLI ne vérifie que ce que le commit touche et garde Docker hors du hook pré-commit ([#852](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/852),
  [#878](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/878)).
- La voie de tests de cycle de vie relance `npm ci` après une coupure réseau du registre, au lieu d'échouer ([#908](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/908)).

## [1.0.0] - 2026-09-27

### Ajouts

#### Commandes CLI

- **`sf modules`** ([#60](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/60)) — `list`, `info` et `match` interrogent le catalogue et classent les intentions par score pondéré.
- **`sf skill`** ([#61](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/61)) — installation, mise à jour et désinstallation des compétences ; `sf uninstall --all` effectue le nettoyage complet.
- **`sf feedback`** ([#62](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/62)) — demande de module, signalement de défaut, liste des propositions et vote communautaire.
- **`sf tools`** — gestion des identifiants multi-comptes pour les services externes.
- **`sf docs`** — serveur local pour la documentation incluse dans le package, utilisable hors ligne.
- **`sf status`** — état du manifeste, des modules et des préconditions sans réinterroger les choix déjà enregistrés.

#### Mode non interactif

- `sf new --non-interactive` expose les options nécessaires au scaffolding scripté ([#58](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/58)).
- `sf update` fournit le dry-run, les stratégies de conflit et l'acceptation explicite des mises à jour de templates ([#59](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/59)).

#### Système de workflow

- Deux presets natifs :
  - **SaaSFoundry**, 7 statuts : `Backlog → Ready → In progress → AI testing → Human testing → In review → Done` ;
  - **SaaSFoundry Solo**, 5 statuts : `Backlog → In progress → AI testing → In review → Done`.
- Création, sauvegarde et réutilisation de workflows personnalisés.
- Quatre niveaux de complexité, avec analyse, approbation, tests et revue contradictoire adaptés au risque.
- Adaptateur GitHub Projects complet, incluant les sous-issues natives et les protections de transition.
- Jira et Linear disponibles à titre expérimental ; Notion fournit le backend SRS v1 complet mais pas un tracker de workflow complet.
- Fermeture progressive des sous-tickets et blocage de la fin du parent tant qu'un enfant reste incomplet ([#79](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/79)).

#### Écosystème de compétences

- **`sf-workflow`** — skill d'orchestration unique, pilotée par le manifeste, compatible Team, Solo et Custom, avec une rigueur adaptée à la complexité.
- **`sf-tool-saasfoundry`** ([#18](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/18)) — prévention de la réinvention, orchestration du feedback et aide aux commandes `sf new` / `sf update`.
- Règles d'intégration partagées pour les modules backend, les pages frontend, les permissions RBAC et les raccordements transverses.
- Schéma de catalogue enrichi ([#60](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/60)).
- Détection du projet et scoring anti-réinvention ([#106](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/106), [#123](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/123)).

#### Infrastructure

- Validation locale et GitHub adaptée à l'impact pour SaaSFoundryAI et les projets monorepo/multirepo générés, avec fallback complet conservateur et contrôle obligatoire stable
  ([#797](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/797)).
- Contrôles pré-commit rapides et validation Docker explicite pendant `AI testing` ([#33](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/33)).
- Couverture Codecov et badge associé.
- Cache local du schéma avec commande de purge ([#137](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/137)).
- Synchronisation de l'adaptateur GitHub Projects et protection contre la dérive ([#138](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/138)).
- Parcours de cycle de vie réels, du navigateur à l'API et PostgreSQL, pour génération et mise à jour.

### Modifications

- La configuration du workflow est centralisée dans `.saasfoundry.json` ; l'ancien `.saasfoundry-workflow.json` est obsolète.
- `getAvailableModules` utilise désormais le catalogue enrichi ([#60](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/60)).
- Le harness peut être utilisé avec plusieurs agents déclarés et conserve la même source de vérité partagée.

### Corrections

- Message d'erreur généralisé lorsque le mode non interactif manque de valeurs ([#59](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/59)).
- `_cache_fresh` tient compte de `OSTYPE` afin d'utiliser le bon champ de `stat` sous GNU ([#135](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/135)).

## [1.0.0-beta]

Première version bêta du générateur :

- **Backend** : NestJS 11, Prisma 7 avec driver adapters, PostgreSQL 16, JWT, Passport et Zod 4.
- **Frontend** : React 19, React Router v7, Vite 7, Tailwind CSS 4, Radix UI, ShadCN UI, React Query, React Hook Form, Zod 4 et i18next.
- **Infrastructure** : builds Docker multi-étapes, Nginx et réseau `saasfoundry-network`.
- **Topologies** : monorepo et multirepo.
- **Modules optionnels** : email MailerSend, stockage S3, analytics Umami, PWA et SRS/harness selon la configuration.
