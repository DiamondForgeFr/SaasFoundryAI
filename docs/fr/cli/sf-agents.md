# sf agents

Gérez plusieurs agents de code sur un harness SaaSFoundry existant. Activer un agent ajoute sa prise en charge sans désactiver les autres.

```bash
sf agents enable codex
sf agents enable kimi --scope local
sf agents refresh
sf agents list --json
sf agents enable codex --scope shared
sf agents replace claude-code codex --scope shared
sf agents catalog --json
sf agents adopt codex claude-code --scope shared
# Remplacer la déclaration après avoir examiné l'aperçu d'adoption du dépôt :
sf agents adopt claude-code codex --mode replace --scope shared
# Examiner l'aperçu, puis appliquer exactement ce plan :
sf agents adopt claude-code codex --mode replace --scope shared --apply --plan <plan-id>
```

## Portée et prérequis

Un projet géré possède `.saasfoundry.json`, `CLAUDE.md` et `.claude/skills`. Utilisez `sf agents catalog` pour connaître les identifiants d'outils enregistrés : les noms de modèles ne sont pas des
profils d'agent.

Les nouveaux harness reçoivent aussi les points d'entrée universels `AGENTS.md` et `GEMINI.md`. Leur présence ne déclare ni Codex ni Gemini : le manifest et l'inventaire local au checkout font foi. Un
point d'entrée personnalisé appartenant à un outil non déclaré est conservé et n'empêche pas l'activation d'un autre profil.

**La portée locale est utilisée par défaut.** Exécutez la commande à la racine d'un checkout Git non bare. La configuration locale écrit les fichiers de découverte enregistrés — dont `AGENTS.md` et le
`GEMINI.md` de Gemini — ainsi que les fichiers `.agents/skills`. Elle stocke l'inventaire personnel et les références validées dans le répertoire Git du checkout. Les fichiers suivis, l'index, la
branche et le manifest partagé restent inchangés. Si une destination suivie doit être modifiée, toute la configuration locale échoue avant d'écrire un fichier. Un fichier suivi identique peut être
réutilisé sans devenir propriété de la configuration locale.

**La portée partagée est explicite.** `--scope shared` enregistre les agents choisis dans le champ facultatif `modules.harness.agents` et produit des fichiers à examiner puis à versionner selon le
workflow normal. Elle fonctionne aussi dans un répertoire géré sans Git. Un ancien manifest dépourvu de ce champ considère Claude Code comme configuré. Partager un agent ne publie pas tous les choix
personnels.

`sf agents adopt` est le point d'entrée pour un dépôt existant qui ne possède pas encore de manifest SaaSFoundry. Par défaut, cette commande ne fait que préparer un aperçu : elle inventorie les
surfaces d'instructions et de skills reconnues, identifie la source qu'elle peut conserver et détaille chaque fichier proposé, prérequis, avertissement et conflit. Elle n'écrit ni fichier, ni
configuration Git, ni exclusion, ni état, ni verrou. L'application exige à la fois `--apply` et l'identifiant exact `--plan <id>` affiché dans l'aperçu. Le plan est recalculé avant l'écriture ; un
identifiant périmé est rejeté si le dépôt a changé.

Ces commandes n'installent aucun runtime, ne modifient ni identifiants ni autorisations et ne certifient pas la découverte native des agents. Les profils sont enregistrés par identifiant d'outil :
`claude-code`, `codex`, `kimi`, `gemini-cli`, `qwen-code` et `generic`. Consultez le catalogue versionné courant avec `sf agents catalog`. Les noms de modèles comme `gpt`, `sonnet` ou `k2` ne sont pas
des identifiants d'agent. Les commandes n'installent pas les runtimes et ne testent pas leur comportement de découverte native.

## Commandes

| Commande                                      | Comportement                                                                                               |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `adopt <agents...> [--scope local\|shared]`   | Prépare un plan par défaut ; ne l'applique qu'avec `--apply --plan <id>`.                                  |
| `enable <agents...> [--scope local\|shared]`  | Ajoute la prise en charge dans la portée choisie ; locale par défaut.                                      |
| `replace <agents...> [--scope local\|shared]` | Remplace exactement la déclaration de cette portée par l'ensemble non vide fourni ; conserve les fichiers. |
| `refresh [--scope local\|shared]`             | Actualise les instructions de cette portée ; locale par défaut.                                            |
| `list`                                        | Présente les agents partagés, locaux et effectifs ainsi que les fichiers découverts.                       |
| `doctor [agents...]`                          | Diagnostique les artefacts et les capacités de l'hôte non vérifiées sans modifier de fichier.              |

Toutes les commandes acceptent `--json`. `list` est en lecture seule et indique `not-checked` pour la découverte du runtime.

## Adopter un dépôt existant

Depuis la racine du dépôt, demandez les profils d'outils à prendre en charge :

```bash
sf agents adopt codex claude-code --json
```

Le plan JSON est versionné et contient `planId`, `source`, l'inventaire existant, les actions proposées sur les fichiers, les conflits, les avertissements, les prérequis et `canApply`. L'aperçu
fonctionne sans manifest ; il peut ainsi expliquer ce qui est réutilisable et, en l'absence de workflow, indiquer `sf workflow` comme prérequis. L'application nécessite un `.saasfoundry.json` existant
et valide. L'aperçu n'en crée ni n'en répare jamais.

Lorsque `canApply` vaut `true`, appliquez exactement le plan examiné :

```bash
sf agents adopt codex claude-code --scope local --apply --plan <plan-id>
```

L'adoption locale reste personnelle au checkout et ne modifie aucun fichier suivi. L'adoption partagée produit un diff d'arbre de travail que l'équipe peut examiner dans son workflow. Aucun mode
n'ajoute à l'index, ne commit, ne pousse, ne change de branche ni ne déplace le fichier source choisi. Un changement d'inventaire, de source, de demande ou de portée produit un nouvel identifiant de
plan et invalide l'ancienne commande d'application.

L'adoption partagée enregistre une version de harness `0` lorsque le manifest ne porte aucun marqueur antérieur. Cela signale l'adoption des instructions sans prétendre que le harness complet et
toutes ses skills ont été installés ; `sf update` peut ainsi distinguer une surface d'instructions adoptée d'un harness complet. Une version de harness existante est conservée.

L'adoption ne crée que des enveloppes de référence. Elle ne copie même pas les fichiers de skills reconnus : un script ou un corps de skill personnalisé peut contenir des identifiants. Les enveloppes
renvoient vers les procédures existantes à lire explicitement, y compris les skills personnalisées. Les actualisations ultérieures des agents conservent ce comportement fondé sur les références.

Un dépôt qui ne contient que `AGENTS.md` peut être adopté pour Codex sans fabriquer de `CLAUDE.md` ni exiger `.claude/skills`. Une référence Claude générée reste facultative si Claude Code est aussi
demandé. Lorsque les racines d'instructions Claude et portables contiennent toutes deux du contenu personnalisé, l'adoption signale un conflit au lieu de choisir silencieusement une priorité. Les
fichiers d'instructions d'origine restent la propriété de l'utilisateur ; seules les enveloppes générées à l'identique reçoivent des références gérées.

Le mode d'adoption est additif par défaut. `--mode replace` rend la déclaration de la portée exactement égale à l'ensemble non vide examiné. Seul l'inventaire change : instructions, copies de skills,
hooks, paramètres et exclusions locales existants sont conservés. Le mode participe à l'identifiant du plan ; un aperçu additif ne peut pas autoriser un remplacement.

## Initialiser une session avec un outil non déclaré

L'hôte courant fournit l'identité de son outil de code. Ne la déduisez jamais d'un nom de modèle ou de fournisseur, d'un exécutable, d'un fichier du dépôt ni du `PATH`. Si l'hôte ne donne pas une
identité sans ambiguïté, choisissez avec l'utilisateur un profil enregistré avant toute modification du projet.

À l'initialisation, exécutez `sf agents list --json`. Si l'outil courant est pris en charge mais absent des inventaires partagé et local au checkout, proposez trois choix : ajouter l'outil, remplacer
la déclaration par un ensemble non vide explicitement nommé, ou ne rien modifier. Ne demandez la portée `local` ou `shared` qu'après le choix d'ajouter ou de remplacer. Le choix de ne rien modifier
n'exécute aucune commande mutante.

Utilisez `sf agents enable <tool>` pour ajouter et `sf agents replace <tools...>` pour remplacer exactement. La portée locale reste privée au checkout ; `--scope shared` crée un diff de dépôt
examinable. Aucune opération n'installe de runtime ni ne modifie les identifiants privés de modèle ou de fournisseur. Un remplacement n'autorise jamais la suppression des fichiers d'adaptation
existants.

## Diagnostiquer les capacités des agents

```bash
sf agents doctor codex claude-code
sf agents doctor --json
sf agents doctor codex --check-runtime --json
```

`doctor` examine tous les profils enregistrés par défaut, ou seulement les identifiants fournis. Il fonctionne dans un dépôt partiel et ne sélectionne jamais de modèle actif. Il lit les indices locaux
sans rien installer, modifier, exécuter comme hook, connecter ni contacter. `--check-runtime` recherche uniquement des exécutables dans le `PATH` sans les lancer. Un hôte bureau ou IDE peut
fonctionner sans CLI correspondant dans le `PATH`.

Le rapport JSON versionné sépare les contrôles du projet de ceux de chaque agent et inclut les instructions d'initialisation. Chaque contrôle possède un identifiant stable, un état, une explication
et, lorsque nécessaire, une remédiation.

La recherche d'exécutables est limitée à 64 Kio et 256 entrées du `PATH`. La recherche des extensions d'exécutables Windows vaut actuellement `not-checked` ; vérifiez la disponibilité dans l'hôte
réel. L'enregistrement partagé est lu dans le manifest ; l'enregistrement privé au checkout reste `not-checked` et peut être consulté séparément avec `sf agents list --json`.

| État          | Signification                                                                                                                 |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `supported`   | L'indice statique annoncé existe, par exemple un artefact d'instructions. Cela ne certifie pas l'exécution par l'hôte.        |
| `unavailable` | L'artefact ou l'exécutable contrôlé est absent. Suivez la remédiation si cet élément est nécessaire.                          |
| `not-checked` | Aucune observation fiable n'a été faite, notamment pour la découverte native, les hooks, l'authentification ou la délégation. |
| `failed`      | Le contrôle a rencontré une surface invalide ou dangereuse, ou une autre erreur de diagnostic.                                |

Le code de sortie `1` indique un contrôle en échec ou une demande invalide ; `0` indique que le rapport a été produit sans contrôle en échec. Des artefacts manquants et des capacités d'hôte non
vérifiées peuvent néanmoins apparaître dans un rapport qui sort avec `0` : lisez chaque contrôle avant de travailler. Présence des fichiers, prise en charge documentée par le fournisseur,
disponibilité de l'exécutable et comportement réel de l'hôte sont quatre faits distincts.

Pour un protocole reproductible d'observation native et des passages sûrs entre Claude et Codex, consultez [la coexistence des agents et la vérification native](/fr/guide/agent-coexistence).

### Initialiser une session lorsque les hooks sont absents ou non vérifiés

1. Chargez le point d'entrée choisi — `CLAUDE.md`, `AGENTS.md` ou `GEMINI.md` — et toutes les instructions projet qu'il référence. Lisez `.saasfoundry.json` pour le workflow, le backend SRS et les
   langues de sortie. Réconciliez toute instruction absente ou contradictoire avant l'implémentation.
2. Exécutez `sf status --agent-friendly --no-network` et traitez ses préconditions. L'option destinée aux agents conserve un code de sortie nul pour rester compatible avec les hooks ; un `fail` dans
   le rapport exige tout de même une résolution. Les hooks `--claude-friendly` existants restent compatibles.
3. Exécutez `sf agents doctor <tool-id>`. Lisez explicitement les skills applicables si leur découverte native n'est pas vérifiée. Une adoption par références peut volontairement laisser les
   procédures dans leur dossier `.claude/skills` ou `.agents/skills` d'origine ; l'absence d'une copie n'autorise pas l'invention d'un processus de remplacement.
4. Lisez la skill de workflow du projet et le document du statut courant, puis appelez le CLI protégé existant avec `status <ticket>`. Utilisez pour les transitions le CLI sélectionné par ces
   instructions. La présence d'un script ne prouve pas que ses garde-fous ont été exécutés. Si les scripts requis manquent, rétablissez le prérequis avec `sf workflow` avant toute transition ; ne les
   remplacez jamais par des mutations directes du tableau.
5. Validez les accès GitHub et SRS nécessaires au moyen du connecteur configuré ou de sa commande de statut en lecture seule. Authentification, accès au dépôt et droits Projects sont des contrôles
   distincts. Laissez les résolveurs d'identifiants existants fonctionner et ne copiez jamais de jetons dans un rapport de diagnostic. Respectez les limites de sandbox, de réseau et d'autorisation de
   l'hôte.
6. Vérifiez les événements de hooks dans l'hôte réel avant de vous y fier. Jusque-là, répétez manuellement ces étapes d'initialisation à chaque session et appliquez explicitement les procédures SRS et
   workflow lorsqu'elles se déclenchent.

### Délégation et revue indépendante

Utilisez la délégation native lorsque l'hôte courant l'expose et que l'autorisation de l'utilisateur le permet. La détection par le CLI ne peut pas établir si la délégation est disponible, autorisée
ou encore dotée de capacité. Si elle est indisponible, signalez cette limite et effectuez séquentiellement l'implémentation ou les recherches possibles.

Une auto-revue séquentielle ne satisfait **pas** une exigence de revue indépendante. Pour un ticket complexe, signalez l'exigence comme incomplète et restez en AI testing jusqu'à l'intervention d'un
contexte agent distinct et autorisé ou d'un relecteur humain indépendant. Ne réduisez pas la complexité, ne contournez pas les garde-fous et ne comptez pas des auto-revues répétées comme relecteurs
indépendants. Les choix de modèle et de niveau de raisonnement restent pilotés par l'hôte ; cette commande ne configure aucun routage.

## Exclusions Git et worktrees

Chaque checkout conserve son propre inventaire et ses propres exclusions. La configuration utilise le mécanisme worktree de Git et un fichier privé d'exclusion, plutôt que le fichier commun
`info/exclude` qui toucherait les worktrees voisins. Les dépôts standards peuvent activer automatiquement `extensions.worktreeConfig`. Une configuration nécessitant une migration Git sans rapport est
rejetée avant toute installation ; résolvez d'abord le prérequis indiqué.

Les instructions générées définissent aussi la politique d'utilisation des worktrees de fonctionnalité. Les agents ne proposent des worktrees parallèles que pour des flux d'écriture indépendants dont
la livraison simultanée est utile ; les explorations et revues en lecture seule peuvent partager un checkout. Les dépendances séquentielles, les fichiers qui se chevauchent et les périmètres
incertains utilisent un seul worktree et une exécution séquentielle. Ce choix est distinct de l'isolation de configuration locale effectuée par `sf agents`.

L'agent lit `workflow.workingBranch` dans `.saasfoundry.json` et conserve le checkout principal sur cette branche configurée. Chaque rédacteur parallèle reçoit un ticket, une branche et un chemin de
worktree, ainsi qu'un périmètre de fichiers et une limite de dépendance explicites. Il démarre depuis une branche de travail configurée et synchronisée. Lorsque l'implémentation parallèle n'a pas déjà
été autorisée, l'utilisateur en conserve le contrôle. Après un merge vérifié, l'agent revient au checkout principal, synchronise la branche de travail, puis ne supprime que le worktree terminé et
inutilisé ainsi que sa branche locale. Les worktrees, branches, stashes et modifications non committées appartenant à l'utilisateur restent intacts.

Les exclusions existantes de l'utilisateur sont préservées sous forme d'instantané dans le fichier privé ; leur source reste inchangée. Les futures modifications de la source ne sont pas synchronisées
automatiquement : réconciliez l'instantané privé lorsqu'elles évoluent. Seuls les chemins locaux gérés à l'identique sont exclus. Si les règles d'ignorance du dépôt laissaient ces fichiers locaux
visibles par Git, la configuration refuse de les écrire. La commande n'utilise jamais `assume-unchanged` ni `skip-worktree` pour masquer des modifications de fichiers suivis.

Lors du partage explicite d'une prise en charge, les règles d'exclusion locales appartenant aux artefacts partagés sont retirées afin que ces fichiers puissent être examinés et ajoutés à Git. Les
règles d'ignorance indépendantes restent sous votre responsabilité.

Le [manuel de `git worktree`](https://git-scm.com/docs/git-worktree#_configuration_file) décrit le mécanisme de configuration et ses prérequis.

## Préservation et conflits

Les instructions, hooks, identifiants et configurations sans rapport sont conservés. Répéter une opération inchangée évite de réécrire le manifest et les fichiers générés.

Disponibilité du runtime, hooks natifs et skills lisibles manuellement sont rapportés comme des capacités distinctes. Un runtime installé ne prouve pas l'exécution de ses hooks ; un fichier Markdown
lisible ne prouve ni la découverte native d'une skill ni l'application du workflow.

La configuration locale prévalide toutes les destinations ; un fichier suivi en conflit ou personnalisé provoque un code de sortie non nul. La configuration partagée conserve son comportement
conscient des conflits : les fichiers personnalisés restent en place, des fichiers latéraux `.saasfoundry.new` proposent un contenu à réconcilier lorsque possible et les références validées sont
conservées pour une nouvelle tentative. Un conflit n'est jamais présenté comme une activation réussie.

`sf update` conserve l'inventaire partagé et les références des fichiers partagés. Après une mise à jour du harness commun, exécutez `sf agents refresh` pour la prise en charge locale ou
`sf agents refresh --scope shared` pour la prise en charge partagée. Les commandes n'ajoutent jamais à l'index, ne commitent, ne poussent ni ne changent de branche Git.

## Profils d'outils et fournisseurs de modèles

Voici la matrice de prise en charge canonique. Le [guide d'installation](/fr/getting-started/installation) y renvoie chaque point de départ au lieu de recopier le tableau.

Le registre de profils décrit comment un outil de code charge les instructions du projet. Il ne choisit ni modèle, ni fournisseur, ni identifiant d'API. Configurez ces éléments personnellement dans
votre outil ; les modifier ne nécessite pas de régénérer les instructions du projet.

`sf agents catalog --json` fonctionne hors d'un projet géré et renvoie la version du registre, la prise en charge de découverte déclarée, les sources documentaires et les limites. Chaque profil
rapporte ses capacités d'exécution comme `not-checked` : une déclaration ne constitue pas un test réussi de connexion ou de découverte.

| Profil        | Instructions                        | Skills partagées                                                                             |
| ------------- | ----------------------------------- | -------------------------------------------------------------------------------------------- |
| `claude-code` | `CLAUDE.md` existant                | Skills Claude existantes                                                                     |
| `codex`       | `AGENTS.md`                         | `.agents/skills`                                                                             |
| `kimi`        | `AGENTS.md`                         | Voir les limites déclarées du profil                                                         |
| `gemini-cli`  | `GEMINI.md` importe `AGENTS.md`     | Alias `.agents/skills` documenté                                                             |
| `qwen-code`   | Chargement de `AGENTS.md` documenté | Lecture explicite de repli ; la découverte native des skills partagées n'est pas revendiquée |
| `generic`     | Chargement manuel de `AGENTS.md`    | Lecture manuelle des skills référencées ; compatibilité non vérifiée                         |

La documentation Gemini sur les [fichiers de contexte](https://geminicli.com/docs/cli/gemini-md/) et les [skills](https://geminicli.com/docs/cli/skills/) décrit ses mécanismes de découverte. La
[documentation mémoire de Qwen](https://qwenlm.github.io/qwen-code-docs/en/users/features/memory/) décrit la lecture d'un fichier `AGENTS.md` existant.

Pour un outil absent de la liste, choisissez explicitement `generic`, puis vérifiez qu'il charge les instructions et peut appeler les commandes protégées du workflow. Les identifiants inconnus et les
noms de modèles ou fournisseurs comme `deepseek`, `gpt` ou `minimax` sont rejetés ; ils ne sont pas associés implicitement à un profil.

Les nouvelles intégrations sont des modifications de données examinées dans `src/harness/agent-profiles.json`, avec parité entre registre et schéma ainsi que tests de dépôt. Les profils ne peuvent
contenir ni commandes, ni identifiants, ni répertoires de sortie arbitraires. Cette release contient uniquement les profils intégrés ; elle ne charge ni n'exécute de plugins de profils distants.

## Notes de plateforme

La suite de tests couvre le CLI et les workflows shell générés sous macOS et Linux. Sous Windows, préférez WSL pour retrouver le même environnement. Les commandes Windows natives peuvent fonctionner,
mais la recherche des extensions d'exécutables reste `not-checked` ; utilisez `sf agents doctor` comme indice borné et vérifiez l'hôte réellement choisi.
