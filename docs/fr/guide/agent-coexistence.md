# Coexistence des agents et vérification native

Cette page décrit le protocole strict de vérification et de transfert. Pour l’installation initiale, le choix des profils, l’adoption d’un projet existant et la portée locale ou partagée des
déclarations, commencez par [Installation](/fr/getting-started/installation). La liste canonique des profils enregistrés reste disponible dans
[`sf agents`](/fr/cli/sf-agents#tool-profiles-and-model-providers).

SaaSFoundryAI peut préparer un projet pour plusieurs hôtes d’agents de développement sans choisir de modèle ni prétendre savoir ce qu’un hôte a chargé. Distinguez trois niveaux de preuve :

- `sf agents list` et `sf agents doctor` rapportent la prise en charge configurée et des preuves statiques bornées ;
- les tests automatisés sur fixtures vérifient fichiers, hashes, modes et sûreté des commandes sans prouver la découverte native ;
- une observation native consigne ce qu’un hôte et une version installés ont réellement chargé ou exécuté.

Un résultat obtenu sur une machine ne certifie ni une autre version de l’hôte, ni un autre contexte d’authentification, ensemble de plugins ou politique de permissions.

Les profils d’agents décrivent seulement la découverte des instructions et des skills. Fournisseurs, runtimes locaux, modèles et niveaux d’effort sont des
[candidats d’exécution](/fr/guide/execution-candidates) distincts. `sf agents` peut ainsi rester additif pour les équipes, tandis qu’un futur routeur compare les cibles réellement accessibles à l’hôte
actif sans inscrire les noms de fournisseurs dans les skills portables.

## Matrice de verdict

Consignez chaque capacité comme `observed`, `structural`, `not-checked`, `blocked` ou `failed`. Réservez `observed` aux preuves produites par l’hôte natif nommé pendant l’exécution.

| Capacité                   | Preuve native d’acceptation                                                                                                            | Preuve restant structurelle                            |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Instructions               | Une valeur aléatoire absente du prompt apparaît depuis le point d’entrée ou une lecture explicitement enregistrée du fichier référencé | Le fichier d’instructions existe                       |
| Métadonnées de skill       | Une description aléatoire apparaît dans l’index natif des skills                                                                       | Le dossier et le frontmatter existent                  |
| Corps du skill             | Invoquer le skill indexé par son nom charge son contenu, en interne ou par une lecture enregistrée                                     | Le nom apparaît dans un index                          |
| Aide du workflow           | Un événement de l’hôte enregistre uniquement la commande d’aide `sf-workflow` déposée et son titre attendu                             | Le lanceur de tests exécute directement le même script |
| Hooks                      | L’événement attendu est observé dans cette exécution                                                                                   | Un fichier de réglages ou de hook existe               |
| Authentification et outils | Les lectures requises du fournisseur, du board et du SRS réussissent sous la politique enregistrée                                     | Un fichier de connexion ou exécutable existe           |
| Délégation                 | Un contexte enfant et son résultat sont observés                                                                                       | L’aide du CLI mentionne une fonction d’agent           |

Exécuter directement l’aide du workflow prouve que le script déposé fonctionne. Le rendu du prompt Codex prouve l’assemblage natif du prompt. Aucun des deux ne prouve qu’un modèle a chargé le corps
d’un skill ou appelé un outil.

## Protocole de fixture contrôlée

Exécutez ce protocole manuellement sur une machine de confiance, jamais sur un projet actif.

1. Relevez la date, le système d’exploitation, le chemin exact de l’exécutable et sa sortie `--version`.
2. Générez un harness dans un répertoire intermédiaire jetable ; l’installateur peut y créer des réglages et hooks.
3. Créez un second dépôt Git jetable pour l’observation. Copiez uniquement son `.saasfoundry.json` borné, le point d’entrée vérifié, les dossiers de skills et la documentation référencée. Si le
   `AGENTS.md` généré référence `CLAUDE.md`, copiez aussi ce fichier et les documents `.claude/` référencés. Ne copiez ni réglages, hooks, `.codex/config.toml`, plugins, configuration MCP ou
   identifiants secrets.
4. Pour Claude Code, utilisez `CLAUDE.md` et `.claude/skills`. Pour Codex, utilisez la référence à sens unique de `AGENTS.md` vers `CLAUDE.md` et `.agents/skills`. Ne créez pas de seconde source
   d’instructions divergente.
5. Ajoutez une valeur aléatoire aux instructions et des valeurs distinctes à la `description` et au corps du skill sonde. Le prompt demande ces preuves et invoque `sf-native-smoke` par son nom, sans
   contenir les valeurs ni le chemin.
6. Relevez le hash et le mode de chaque fichier avant et après chaque commande.

Le skill sonde demande à l’hôte de lire uniquement les instructions applicables et les skills choisis, puis d’exécuter la commande d’aide déposée. Copiez le dossier `sf-workflow` de la release ; ne le
remplacez pas par un script simulé.

Établissez d’abord les preuves structurelles :

```bash
sf agents doctor claude-code --json
sf agents doctor codex --json
bash .claude/skills/sf-workflow/workflow-cli.sh help
bash .agents/skills/sf-workflow/workflow-cli.sh help
```

Exigez un code de sortie `0`, le titre `sf-workflow` de la release et une fixture inchangée. Classez ces résultats comme `structural`.

## Assemblage du prompt Codex sans modèle

Lorsque `codex debug prompt-input --help` expose la commande, exécutez-la avec des `HOME` et `CODEX_HOME` temporaires vides, un environnement minimal, un bac à sable en lecture seule et les
approbations désactivées :

```bash
codex --sandbox read-only --ask-for-approval never -C "$fixture" debug prompt-input \
  "Report the project instructions and available skill names."
```

Vérifiez la position des options dans l’aide installée. Certaines options de `codex exec`, notamment `--ignore-user-config` et `--ignore-rules`, ne sont pas forcément acceptées par
`debug prompt-input`.

L’entrée rendue doit contenir la valeur d’instruction inconnue, la description inconnue du skill sonde et le nom du skill `sf-workflow` livré. La fixture doit rester inchangée. Classez la découverte
des instructions et métadonnées comme `observed`, mais le chargement du corps et l’exécution du workflow par un modèle comme `not-checked`.

## Observation optionnelle avec un modèle

Cette étape contacte le fournisseur configuré et peut consommer un quota payant. Ne l’exécutez qu’après autorisation explicite. Arrêtez-vous plutôt que de copier des identifiants secrets ou
d’affaiblir l’isolation lorsqu’un environnement vide ne peut pas s’authentifier.

Pour Codex, consultez `codex exec --help` et utilisez, lorsqu’elles sont prises en charge, les options `--sandbox read-only`, `--ask-for-approval never`, `--ephemeral`, `--ignore-user-config`,
`--ignore-rules`, `--color never` et `--json`. N’utilisez ni automatisation des approbations, ni contournement dangereux, recherche, répertoire inscriptible supplémentaire, contrôle distant ou plugin.

Pour Claude Code, consultez l’aide locale et utilisez si disponibles :

```text
--print --restricted --setting-sources project --strict-mcp-config
--tools Read,Bash
--permission-mode dontAsk --permission-prompts none
--no-session-persistence --no-chrome --prompt-suggestions false
--output-format stream-json --verbose
```

Fournissez une configuration MCP vide. Autorisez seulement le point d’entrée absolu de la fixture, ses instructions référencées, `sf-native-smoke/SKILL.md`, les fichiers `sf-workflow` référencés et la
commande d’aide exacte. N’utilisez pas de contournement de permissions, plugin, navigateur ou contrôle distant.

Les options Claude `--safe-mode` et `--bare` désactivent la découverte testée et ne peuvent donc pas établir ce résultat. Une politique administrée peut encore affecter une exécution restreinte :
consignez cette limite au lieu d’affirmer une isolation complète.

Pour chaque hôte, inspectez le flux d’événements. N’acceptez les lectures internes, appels de lecture ou commandes `cat` en lecture seule que pour la chaîne d’instructions vérifiée et les skills
sélectionnés. La seule commande shell non dédiée à la lecture est le script de workflow avec l’unique argument `help` ; rejetez opérateurs, redirections et arguments supplémentaires. Exigez toutes les
valeurs inconnues, le titre du workflow et une fixture inchangée.

Ne conservez que l’hôte et sa version, les codes de sortie, comparaisons de hash et de modes, correspondances booléennes des nonces, classifications normalisées des fichiers et commandes autorisés et
catégories d’échec fixes. Ne publiez ni prompts bruts, flux d’événements, environnements ou erreurs d’authentification : ils peuvent contenir des données sans rapport.

## Acceptation humaine dans ce dépôt

La fixture contrôlée teste le mécanisme de chargement. L’acceptation de ce dépôt utilise le même ticket réel et la même exigence SRS canonique dans deux worktrees isolés, un par hôte. N’exécutez pas
les deux dans le checkout principal.

Avant toute action, relevez numéro et statut du ticket, labels de complexité et de nature, page SRS canonique, commit de base et langue de sortie. Dans chaque worktree, l’hôte affecté doit :

1. exécuter `sf status --agent-friendly --no-network` et résoudre les préconditions en échec ;
2. exécuter `sf agents doctor <tool-id>` sans assimiler les contrôles statiques à des preuves natives ;
3. lire le même document de statut et interroger le même ticket via le CLI de workflow protégé ;
4. lire la même exigence canonique depuis le backend SRS configuré ;
5. consigner version de l’hôte, worktree, branche, commit, fichiers, validation et éléments encore `not-checked`.

Le premier hôte committe son travail borné avant le transfert. Créez le second worktree depuis ce commit revu, sur sa propre branche, puis faites répéter au second hôte les lectures du ticket et du
SRS avant toute modification. Une divergence est un échec de transfert : ne la masquez pas en modifiant le board ou en substituant une autre exigence. Un seul propriétaire nommé gère les transitions
de workflow.

L’acceptation exige que les deux hôtes rapportent le même ticket et le même état SRS, que le second préserve le travail accepté du premier, que les contrôles requis réussissent et que chaque
transition passe par la commande protégée. Une connexion fournisseur ou un simple test du système de fichiers ne suffit pas.

## Référence dogfood SaaSFoundryAI

Ce dépôt déclare ensemble `claude-code` et `codex` dans `.saasfoundry.json`. `CLAUDE.md`, `AGENTS.md` et les arbres vérifiés `.claude/skills` et `.agents/skills` sont partagés. `AGENTS.md` renvoie
Codex aux mêmes règles faisant autorité et au même workflow protégé. Les réglages privés `.codex`, identifiants secrets, plugins, configurations MCP, choix de modèle et permissions de l’hôte ne font
pas partie de la déclaration et ne doivent pas être committés comme preuves.

Testez la déclaration depuis un clone ou worktree jetable contenant uniquement les fichiers suivis et revus. Les deux hôtes doivent résoudre le même manifeste, ticket, SRS et document de statut ; les
deux commandes d’aide doivent exposer les mêmes garde-fous. Les parités de fichiers et exécutions directes restent `structural`. Chargement natif, hooks, authentification, délégation et comportement
du modèle ne deviennent `observed` que si l’hôte et la version nommés les ont produits. Une observation absente reste `not-checked`.

Dans un projet généré, un monorepo possède une racine unique de harness. En multirepo, les dépôts API et Web reçoivent chacun un manifeste minimal `structure: cli` et leurs points d’entrée d’agents ;
chaque checkout peut ainsi s’initialiser indépendamment sans confondre le dépôt interne avec le coordinateur de la stack.

## Travail séquentiel et simultané au quotidien

Hors de cet exercice, un travail séquentiel peut partager un checkout après l’arrêt du premier hôte et un transfert précis. Le suivant revérifie manifeste, ticket, SRS et diff plutôt que de supposer
le transfert du contexte de session.

Avant l’implémentation, découpez la demande en flux d’écriture et dépendances. Ne proposez plusieurs worktrees que si les flux sont indépendants et que leur exécution concurrente apporte un bénéfice
réel. Exploration et revue en lecture seule peuvent être parallèles dans un checkout. Des dépendances séquentielles, fichiers communs ou responsabilités floues imposent un seul worktree de feature.

Lisez `workflow.workingBranch` dans `.saasfoundry.json` sans inventer de branche conventionnelle. Gardez le checkout principal sur cette branche. Chaque rédacteur parallèle reçoit un ticket réel, une
branche, un worktree, un ensemble de fichiers possédés et une frontière de dépendance explicites. Partez d’une branche de travail synchronisée, restez dans la responsabilité attribuée et préservez les
changements sans rapport. Si l’utilisateur n’a pas déjà autorisé l’implémentation parallèle, présentez-lui cette organisation avant de démarrer les rédacteurs.

Après fusion d’un flux, revenez au checkout principal, synchronisez la branche configurée et vérifiez la fusion. Ne supprimez le worktree et la branche locale qu’après cette vérification et lorsqu’ils
ne sont plus utilisés. Préservez les worktrees, branches, stashes et changements non committés de l’utilisateur. Si Git, l’autorisation, la synchronisation ou la séparation propre font défaut, exposez
la contrainte et continuez séquentiellement.

Une auto-revue séquentielle ne satisfait pas une exigence de revue indépendante. Laissez cette exigence incomplète en `AI testing` jusqu’à la revue d’un autre contexte d’agent autorisé ou d’un humain
indépendant.

Consignez chaque transfert sous cette forme :

```text
Hôte et version :
Ticket, statut, complexité et nature :
Page ou exigence SRS canonique :
Branche, worktree et commit :
Fichiers possédés ou modifiés :
Contrôles et observations natives :
Éléments non vérifiés ou bloqués :
Prochaine action de workflow autorisée :
```
