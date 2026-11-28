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
sf agents route --task bug-fix --json
sf agents delegation status
sf agents adopt codex claude-code --scope shared
# Remplacer la déclaration après avoir examiné l'aperçu d'adoption du dépôt :
sf agents adopt claude-code codex --mode replace --scope shared
# Examiner l'aperçu, puis appliquer exactement ce plan :
sf agents adopt claude-code codex --mode replace --scope shared --apply --plan <plan-id>
```

## Portée et prérequis

Un projet géré possède `.saasfoundry.json`, un fichier d'instructions `AGENTS.md` et `.claude/skills`. Utilisez `sf agents catalog` pour connaître les identifiants d'outils enregistrés : les noms de
modèles ne sont pas des profils d'agent.

`AGENTS.md` est le fichier d'instructions de référence d'un nouveau projet ; le CLI n'écrit plus `CLAUDE.md` ni `CLAUDE.local.md` lors d'une nouvelle installation. Sa présence ne déclare ni Codex ni
aucun autre outil : le manifest et l'inventaire local au checkout font foi. Les profils déclarés n'ajoutent que ce dont leur outil a besoin : `.claude/rules/claude-code.md` pour `claude-code`,
`GEMINI.md` (qui importe `AGENTS.md`) pour `gemini-cli`, les copies `.agents/skills` pour chaque profil déclaré autre que Claude Code, et les [agents de palier](#agents-de-palier) pour `claude-code`
et `codex`. Un point d'entrée personnalisé appartenant à un outil non déclaré, comme un `GEMINI.md` existant, est conservé et n'empêche pas l'activation d'un autre profil.

Le `AGENTS.md` racine se termine par une région générée, délimitée par `<!-- saasfoundry:generated:start -->` et `<!-- saasfoundry:generated:end -->`. `sf update` et `sf agents enable` ne réécrivent
que cette région ; le reste du fichier appartient au projet. Un `AGENTS.md` sans ces marqueurs a été écrit par vous et n'est jamais réécrit.

La région contient ce que tout agent lit avant d'ouvrir un skill : éditions de fichiers et appels shell, lecture du statut du projet, le ticket avant le code, le travail d'UI, l'identité de l'agent de
code, les capacités d'exécution, qui construit un ticket (les états du consentement de la [livraison déléguée des tickets](#livraison-deleguee-des-tickets-sf-agents-delegation)) et les worktrees.
Chaque règle n'y figure qu'une fois. Ce qu'un skill, un garde-fou ou la CLI possède déjà est un renvoi qui nomme le cas qui y envoie l'agent : la procédure de délégation (la route, le brief,
l'enregistrement, les reprises) est `reference/delegation.md` du skill `sf-workflow`, le passage d'un projet au profil `full` est `flows/update.md` du skill `tool-saasfoundry`, et le sens de la ligne
`local-ci:` de `sf status` est le document de statut AI Testing. Les copies de skills sous `.agents/skills/` s'ouvrent sur les capacités d'exécution et un renvoi vers les règles de délégation et de
worktree de la région, non sur les règles elles-mêmes. Les trois ponts générés que `sf update` reconnaît à leurs octets (un `AGENTS.md` au-dessus d'un `CLAUDE.md` qui est le vôtre, sa variante
d'adoption, un `CLAUDE.md` au-dessus d'un `AGENTS.md`) gardent leur texte inchangé.

Le `CLAUDE.md` des projets installés avant ce changement est déplacé dans `AGENTS.md` par [`sf update`](/fr/cli/sf-update#claude-md-passe-dans-agents-md-harness-v4) ; `sf agents` lui-même ne déplace
ni ne supprime jamais un fichier d'instructions.

**La portée locale est utilisée par défaut.** Exécutez la commande à la racine d'un checkout Git non bare. La configuration locale écrit les fichiers de découverte des profils déclarés — par exemple
le `GEMINI.md` de Gemini — ainsi que les fichiers `.agents/skills`. Elle stocke l'inventaire personnel et les références validées dans le répertoire Git du checkout. Les fichiers suivis, l'index, la
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

**Un nom non enregistré est refusé, avec une suggestion quand il ressemble à un nom enregistré.** `enable`, `replace`, `adopt`, `list` (un manifest qui déclare ce nom) et `route --provider` refusent
un nom qu'aucun profil n'enregistre et sortent avec un code non nul. Quand le nom ne diffère d'un identifiant ou d'un nom d'affichage enregistré que par la casse, la ponctuation ou une faute de frappe
(`kimi-code`, `Kimi`, `kimi_code`), le message ajoute `Did you mean kimi?` :

```text
'kimi-code' is not a registered coding agent. Did you mean kimi? Routed coding agents: claude-code, codex, kimi.
```

La suggestion n'est qu'une aide. sf n'accepte, n'infère et n'alias jamais le nom : relancez la commande avec l'identifiant enregistré. Un nom sans correspondance proche, comme `moonshot` ou `gpt-5`,
est refusé sans suggestion.

## Commandes

| Commande                                                             | Comportement                                                                                                                          |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `adopt <agents...> [--scope local\|shared]`                          | Prépare un plan par défaut ; ne l'applique qu'avec `--apply --plan <id>`.                                                             |
| `enable <agents...> [--scope local\|shared]`                         | Ajoute la prise en charge dans la portée choisie ; locale par défaut.                                                                 |
| `replace <agents...> [--scope local\|shared]`                        | Remplace exactement la déclaration de cette portée par l'ensemble non vide fourni ; conserve les fichiers.                            |
| `refresh [--scope local\|shared]`                                    | Actualise les instructions de cette portée ; locale par défaut.                                                                       |
| `list`                                                               | Présente les agents partagés, locaux et effectifs ainsi que les fichiers découverts.                                                  |
| `doctor [agents...]`                                                 | Diagnostique les artefacts et les capacités de l'hôte non vérifiées sans modifier de fichier.                                         |
| `route --task <kind> [--provider <agent>]`                           | Indique le modèle et le niveau de raisonnement que la grille d'allocation recommande pour un type de tâche délégué.                   |
| `delegation <allow\|decline\|status\|clear> [--scope shared\|local]` | Enregistre, lit ou retire l'accord du développeur pour déléguer la livraison des tickets à des agents en arrière-plan.                |
| `outcome <record\|mark\|capture\|status-event>`                      | Enregistre ce qu'une délégation routée a coûté et si elle a fait le travail, lui rattache un signal ultérieur, chronomètre un ticket. |
| `routing <adjust\|promote\|report\|reset>`                           | Ajuste le routage d'après ces résultats, partage un déplacement, les rapporte, annule un déplacement.                                 |
| `guard --host <claude-code\|codex>`                                  | Lancée par le hook `PreToolUse` : refuse les appels d'outil qu'un agent ne doit pas faire de lui-même.                                |
| `shell-guard <refuse\|warn\|off\|status>`                            | Enregistre ou lit ce que fait le garde d'une ligne de shell qui n'est pas une commande simple.                                        |

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

1. Chargez le point d'entrée du projet — `AGENTS.md`, `GEMINI.md`, ou `CLAUDE.md` dans un projet installé avant que `AGENTS.md` ne fasse foi — et toutes les instructions projet qu'il référence. Lisez
   `.saasfoundry.json` pour le workflow, le backend SRS et les langues de sortie. Réconciliez toute instruction absente ou contradictoire avant l'implémentation.
2. Exécutez `sf status --agent-friendly --no-network` et traitez ses préconditions. L'option destinée aux agents conserve un code de sortie nul pour rester compatible avec les hooks ; un `fail` dans
   le rapport exige tout de même une résolution. L'alias `--claude-friendly` reste accepté ; un hook de début de session qui exécute la commande nue `sf status --claude-friendly --no-network` est
   remplacé par un refresh par un hook qui exécute le CLI propre au projet ([le hook de début de session](/fr/cli/sf-status#le-hook-de-debut-de-session)).
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
indépendants. L'hôte lance chaque délégation. Le workflow nomme un type de tâche pour chacune ; l'agent le résout avec [`sf agents route`](#routage-des-delegations-sf-agents-route) et confie le
travail à l'agent `sf-<palier>` indiqué, qui porte le modèle et le niveau de raisonnement.

## Exclusions Git et worktrees

Chaque checkout conserve son propre inventaire et ses propres exclusions. La configuration utilise le mécanisme worktree de Git et un fichier privé d'exclusion, plutôt que le fichier commun
`info/exclude` qui toucherait les worktrees voisins. Les dépôts standards peuvent activer automatiquement `extensions.worktreeConfig`. Une configuration nécessitant une migration Git sans rapport est
rejetée avant toute installation ; résolvez d'abord le prérequis indiqué.

Les instructions générées définissent aussi la politique d'utilisation des worktrees de fonctionnalité. Les agents ouvrent des worktrees parallèles lorsque la
[délégation](#livraison-deleguee-des-tickets-sf-agents-delegation) enregistrée vaut `allowed` ou que le développeur le demande, et seulement pour des flux d'écriture indépendants dont la livraison
simultanée est utile ; les explorations et revues en lecture seule peuvent partager un checkout. Les dépendances séquentielles, les fichiers qui se chevauchent et les périmètres incertains utilisent
un seul worktree et une exécution séquentielle. Ce choix est distinct de l'isolation de configuration locale effectuée par `sf agents`.

L'agent lit `workflow.workingBranch` dans `.saasfoundry.json` et conserve le checkout principal sur cette branche configurée. Chaque rédacteur parallèle reçoit un ticket, une branche et un chemin de
worktree, ainsi qu'un périmètre de fichiers et une limite de dépendance explicites. Il démarre depuis une branche de travail configurée et synchronisée. La délégation enregistrée n'autorise que la
livraison des tickets : pour tout autre flux d'écriture parallèle, et pour les tickets lorsqu'elle ne vaut pas `allowed` ou que la demande en cours dit le contraire, l'agent propose ce découpage
parallèle et attend la réponse. Après un merge vérifié, l'agent revient au checkout principal, synchronise la branche de travail, puis ne supprime que le worktree terminé et inutilisé ainsi que sa
branche locale. Les worktrees, branches, stashes et modifications non committées appartenant à l'utilisateur restent intacts.

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
`sf agents refresh --scope shared` pour la prise en charge partagée. `sf update` maintient lui-même `.claude/settings.json` à jour (les hooks de capture des délégations et les règles de permission) :
un refresh n'est plus nécessaire après une mise à jour pour ce fichier, voir [Capture des délégations et permissions](/fr/cli/sf-update#capture-des-delegations-et-permissions-harness-v5). Les
commandes n'ajoutent jamais à l'index, ne commitent, ne poussent ni ne changent de branche Git.

## Profils d'outils et fournisseurs de modèles

Voici la matrice de prise en charge canonique. Le [guide d'installation](/fr/getting-started/installation) y renvoie chaque point de départ au lieu de recopier le tableau.

Le registre de profils décrit comment un outil de code charge les instructions du projet. Il ne choisit ni le modèle de votre session, ni son fournisseur, ni son identifiant d'API. Configurez ces
éléments personnellement dans votre outil ; les modifier ne nécessite pas de régénérer les instructions du projet. La grille d'allocation recommande seulement un modèle et un niveau de raisonnement
par type de tâche délégué (voir plus bas).

`sf agents catalog --json` fonctionne hors d'un projet géré et renvoie la version du registre, la prise en charge de découverte déclarée, les sources documentaires, les limites et le
[bloc de capacités](#le-bloc-de-capacites-d-un-profil). Chaque profil rapporte ses capacités d'exécution comme `not-checked` : une déclaration ne constitue pas un test réussi de connexion ou de
découverte.

| Profil        | Instructions                        | Découverte des skills documentée                                                                                   | Skills fournies par le harness                         |
| ------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| `claude-code` | `AGENTS.md`                         | [`.claude/skills`](https://code.claude.com/docs/en/skills)                                                         | `.claude/skills` (les sources)                         |
| `codex`       | `AGENTS.md`                         | [`.agents/skills`](https://learn.chatgpt.com/docs/build-skills)                                                    | Copie `.agents/skills`                                 |
| `kimi`        | `AGENTS.md`                         | [`.kimi-code/skills`, `.agents/skills`](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/skills.html) | Copie `.agents/skills`                                 |
| `gemini-cli`  | `GEMINI.md` importe `AGENTS.md`     | [`.gemini/skills`, alias `.agents/skills`](https://geminicli.com/docs/cli/skills/)                                 | Copie `.agents/skills`                                 |
| `qwen-code`   | Chargement de `AGENTS.md` documenté | [`.qwen/skills`](https://qwenlm.github.io/qwen-code-docs/en/users/features/skills/)                                | Copie `.agents/skills`, à lire explicitement           |
| `generic`     | Chargement manuel de `AGENTS.md`    | Aucune                                                                                                             | Copie `.agents/skills`, lecture manuelle ; non vérifié |

Le champ `skillDiscovery` de chaque profil, dans `sf agents catalog --json`, enregistre ces répertoires et la page qui les documente. La copie `.agents/skills` n'est écrite que si un profil déclaré ne
lit pas `.claude/skills` : un projet qui ne déclare que Claude Code n'en reçoit aucune. La copie traduit dans la prose les tournures propres à Claude (`$ARGUMENTS`, l'outil Task, l'injection de
contexte `` !`commande` ``) et conserve octet pour octet chaque bloc de code et chaque code inline. Qwen Code ne documente pas la lecture de `.agents/skills`, et le harness n'écrit pas `.qwen/skills`
: indiquez-lui la copie explicitement.

Claude Code lit `AGENTS.md` nativement à partir de la version 2.1.277, mais uniquement lorsqu'aucun `CLAUDE.md` n'existe dans le projet ni dans un répertoire parent. `sf agents list` et
`sf agents catalog` affichent le profil sous la forme `Claude Code — AGENTS.md`. Les instructions propres à Claude Code (hook `SessionStart`, invocation des skills par `/sf-<name>`, liste
d'autorisations de `.claude/settings.json`) se trouvent dans `.claude/rules/claude-code.md`.

La documentation Gemini sur les [fichiers de contexte](https://geminicli.com/docs/cli/gemini-md/) et les [skills](https://geminicli.com/docs/cli/skills/) décrit ses mécanismes de découverte. La
[documentation mémoire de Qwen](https://qwenlm.github.io/qwen-code-docs/en/users/features/memory/) décrit la lecture d'un fichier `AGENTS.md` existant. La
[documentation des agents de Kimi Code](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/agents.html) nomme `AGENTS.md`, dans l'arborescence du projet, comme fichier d'instructions : son
profil passe donc à `documented` et ne demande plus de charger le fichier à la main ; il reste `runtime: not-checked`, et la
[documentation des hooks](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/hooks.html) explique pourquoi le harness n'installe aucun hook pour lui (voir [Kimi Code](#kimi-code)).

Pour un outil absent de la liste, choisissez explicitement `generic`, puis vérifiez qu'il charge les instructions et peut appeler les commandes protégées du workflow. Les identifiants inconnus et les
noms de modèles ou fournisseurs comme `deepseek`, `gpt` ou `minimax` sont rejetés ; ils ne sont pas associés implicitement à un profil.

Les nouvelles intégrations sont des modifications de données examinées dans `src/harness/agent-profiles.json`, avec parité entre registre et schéma ainsi que tests de dépôt. Les profils ne peuvent
contenir ni commandes, ni identifiants, ni répertoires de sortie arbitraires. Cette release contient uniquement les profils intégrés ; elle ne charge ni n'exécute de plugins de profils distants.

### Le bloc de capacités d'un profil

Au-delà de la façon dont un outil charge les instructions et les skills, chaque profil déclare dans un bloc `capabilities` ce que le harness fait pour cet outil. Les fournisseurs routés, les efforts
qu'un outil sait écrire, les dossiers et formats des agents de palier, les fichiers de hooks et les formulations de `sf status` en sont tous lus : aucune autre source ne nomme Claude Code ou Codex
pour les décider, si bien qu'un nouvel outil commence par être une modification de données.

| Champ         | Dit                                                                                                                                                                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `routing`     | `{ vendor, efforts }` : la grille a des candidats pour l'outil, rangés sous ce fournisseur, et un fichier d'agent de palier de l'outil sait exprimer ces efforts. `null` sinon                                                                                                 |
| `tierAgents`  | `{ dir, format, modelBinding }` : le dossier du projet où l'outil lit ses sous-agents, leur format de fichier (`claude-md`, `codex-toml`, `kimi-md`) et si le modèle est écrit dans le fichier (`file`) ou choisi à chaque appel (`call-alias`). `null` sinon. Exige `routing` |
| `hooks`       | `{ scope, file, guardEvent, captureEvent, needsTrust }` : le fichier qui déclare les hooks de l'outil (portée `project` ou `user`), les événements du hook de garde et du hook de capture, et si l'outil n'exécute un hook de projet qu'une fois approuvé. `null` sinon        |
| `worktrees`   | `native` (l'outil isole lui-même un délégué dans un worktree), `manual` (la session l'ouvre avec Git) ou `none`                                                                                                                                                                |
| `limitations` | La raison de chaque capacité qui manque à l'outil, indexée par nom de capacité                                                                                                                                                                                                 |

**La règle d'une capacité manquante.** Un profil auquel une capacité manque (un bloc `null`, ou `worktrees` autre que `native`) doit dire pourquoi dans `limitations`, et ne dit rien d'une capacité
qu'il a : le registre refuse un profil qui enfreint l'une ou l'autre moitié. Toute commande qui a besoin de la capacité nomme alors cette raison au lieu d'un simple « pas de routage ».
`sf agents route --provider gemini-cli` répond
`gemini-cli (Gemini CLI) cannot be routed: The harness ships no routing candidates for Gemini CLI, so sf agents route cannot name a tier for it. Routed coding agents: claude-code, codex, kimi.`, et
`sf status` dit qu'un garde ou une capture est `unavailable (<raison>)` pour un outil dont le profil ne déclare aucun hook. Un identifiant qu'aucun profil n'enregistre est déclaré non enregistré.
`sf status` lit un hook comme `enforced` quand le harness l'installe et que l'outil l'exécute, `declared` quand l'outil doit d'abord l'approuver (`needsTrust`), et `not enforced` pour un outil dont le
profil a des hooks que rien n'exécute.

Seuls les formats de fichier diffèrent dans le code : chaque `tierAgents.format` a un moteur de rendu, au-dessus du même modèle d'agent de palier (nom, description, modèle, effort, instructions), et
un format sans moteur de rendu ne compile pas. Tout ce qui ne diffère que par sa valeur (un dossier, une liste d'efforts, un nom d'événement) est un champ du profil. Le bloc n'ajoute aucun champ à
`.saasfoundry.json` : il n'exige donc aucune migration du manifeste.

## Routage des délégations (`sf agents route`)

Un agent de code qui délègue du travail peut demander quel modèle et quel niveau de raisonnement la tâche mérite, au lieu de lancer chaque sous-agent sur le modèle de la session :

```bash
sf agents route --task bug-fix --json
sf agents route --task terminal-ci --provider codex
```

Le CLI livre une grille d'allocation versionnée. Chaque type de tâche (`exploration`, `scoped-edit`, `bug-fix`, `multi-file-feature`, `tests`, `review`, `planning`, `terminal-ci`, `prose`) désigne un
palier, et chaque palier désigne un candidat (modèle et niveau de raisonnement) pour Claude Code, pour Codex et pour Kimi Code. La sortie donne le palier, le candidat sous la forme d'un identifiant
canonique `provider/runtime/model/effort`, l'origine de la décision (`shipped` ou `project`) et la preuve qui fonde une entrée livrée. Un hôte dont le fichier d'agent de palier ne lie aucun modèle,
Kimi Code, reçoit aussi l'alias de modèle que l'appel passe (voir [Kimi Code](#kimi-code)). La commande fonctionne hors d'un projet géré ; dans un projet, elle répond pour les agents de code déclarés
qui disposent de candidats. Un agent de code sans routage est refusé avec la limitation que documente son profil (voir [le bloc de capacités](#le-bloc-de-capacites-d-un-profil)), jamais avec un simple
« pas de routage ».

Chaque entrée livrée cite sa preuve. Une entrée `measured` porte le benchmark public, sa date, son score et son coût par tâche : c'est le candidat le moins cher à moins de 5 points du meilleur score
mesuré pour au plus la moitié de son coût, comparé au sein d'une même source. Une entrée `provisional` nomme l'indicateur le plus proche et n'a pas de score : aucun benchmark public ne mesure ce type
avec un coût, et le banc de rejeu des mainteneurs la remplace par une mesure. Certains types excluent aussi les candidats dont les scores s'effondrent, comme Haiku pour le terminal et la CI.

Un projet surcharge la grille dans `.saasfoundry.json` :

```json
{
  "modules": {
    "harness": {
      "version": 4,
      "agents": ["claude-code", "codex"],
      "routing": {
        "kinds": { "scoped-edit": { "tier": "build" } },
        "tiers": { "light": { "codex": { "model": "gpt-6-luna", "effort": "max" } } }
      }
    }
  }
}
```

`kinds` remplace le palier d'un type de tâche ; `tiers` remplace le candidat d'un palier pour un agent ou déclare un palier propre au projet. Le schéma du manifeste valide les deux. Une surcharge est
signalée avec l'origine `project` ; elle ne garde la preuve livrée que si elle aboutit au candidat livré pour ce type ; celle qui tombe sur un candidat exclu est signalée par un avertissement, pas
refusée. Une surcharge invalide fait échouer la commande au lieu de revenir silencieusement à la grille. `sf agents enable`, `replace` et `sf update` conservent le bloc `routing`.

La grille recommande ; elle ne lance rien. Le modèle, le fournisseur et les identifiants de votre session restent configurés dans votre outil.

La réponse reflète aussi les exécutions propres au projet (voir [Délégations mesurées](#delegations-mesurees-et-routage-ajuste)). L'ordre est : la surcharge partagée du développeur dans
`modules.harness.routing`, puis les déplacements que l'ajustement automatique a faits dans ce clone (source `auto`, avec le déplacement et sa règle dans `adjustment`), puis la grille livrée. Dans la
limite de la part déclarée des exécutions d'un type, la réponse est le palier moins cher situé sous le palier routé (ou un nouveau candidat plus fort situé au-dessus) et le dit avec `trial: true` et
`effectiveTier` ; déléguez à ce palier. `--no-trial` répond le palier routé, pour l'affichage. `--record` (avec `--ticket`, `--complexity`, `--nature`, `--retry-of`) émet un **enregistrement de
route** pour une délégation mesurée : il affiche `route=<id>` à mettre dans le brief et réserve l'essai qu'il accorde (voir [Enregistrements de route](#enregistrements-de-route)). Avec `--ticket` et
sans `--complexity` (ou `--nature`), la valeur est lue dans les étiquettes du ticket. Un registre ou une couche locale endommagés sont signalés sur stderr et le routage partagé répond.

### Kimi Code

Kimi Code est routé par son profil et par la grille (`routing: { vendor: "moonshot", efforts: ["low", "high", "max"] }`), et écrit aussi ses agents de palier à partir de son profil
(`tierAgents: { dir: ".kimi-code/agents", format: "kimi-md", modelBinding: "call-alias" }`) : aucune commande n'a de branche pour lui, et seul son format de fichier a un moteur de rendu. Ses candidats
sont `moonshot/kimi/<modèle>/<effort>` :

| Palier     | Types de tâche                | Candidat (modèle, effort) |
| ---------- | ----------------------------- | ------------------------- |
| `light`    | `exploration`, `prose`        | `k3`, `low`               |
| `edit`     | `scoped-edit`                 | `k3`, `high`              |
| `build`    | `multi-file-feature`, `tests` | `k3.1-pro`, `high`        |
| `fix`      | `bug-fix`, `review`           | `k3.1-pro`, `high`        |
| `plan`     | `planning`                    | `k3.1-pro`, `high`        |
| `terminal` | `terminal-ci`                 | `k3.1-pro`, `max`         |

- **Toute route Kimi est provisoire.** Aucun benchmark public ne mesure ces candidats avec un coût : chaque entrée n'a ni score ni coût, et `sf agents route` le dit dans sa preuve
  (`provisional: No Kimi measurement exists yet; …`). Le banc de rejeu des mainteneurs les remplace par des mesures. Les alias `highspeed` ne sont pas utilisés : ils facturent deux fois.
- **Efforts.** Kimi Code exprime `low`, `high` et `max`. Une surcharge de projet d'un palier Kimi à tout autre effort (`minimal`, `medium`, `xhigh`, `ultra`) est refusée, et nomme les trois qu'elle
  accepte.
- **Des agents de palier, et l'alias de modèle qu'une route nomme.** `sf agents refresh` écrit `.kimi-code/agents/sf-<palier>.md` pour chaque palier : un fichier Markdown dont le frontmatter porte
  `name`, `description`, `whenToUse` et une liste `tools` explicite (la même pour tous les paliers, terminée par `mcp__*` pour que les outils MCP de la session atteignent le délégué), et dont le corps
  est `${base_prompt}` (le prompt système par défaut de Kimi Code) suivi des instructions que porte chaque agent de palier. **Le fichier ne nomme ni modèle ni effort** : Kimi Code ne lie aucun modèle
  dans un fichier d'agent. Un appel à l'outil `Agent` passe `model: <alias>`, une clé de votre propre pool `[secondary_model.models]` ; la route nomme donc l'alias, et la session le recopie :

  ```text
  bug-fix → fix (shipped) kimi: k3.1-pro, effort high, alias sf-k3-1-pro-high — provisional: …  route=<id>
  ```

  `--json` ajoute `alias` à la route et `aliasPool` (`present`, `missing` ou `unknown` : votre pool le déclare-t-il). Les deux champs sont optionnels et additifs, donc `routeVersion` reste 2 ; une
  route Claude Code ou Codex n'en porte aucun. L'alias porte le nom du candidat, pas celui du palier (`sf-<modèle>-<effort>`, un point dans le nom du modèle s'écrivant `-`) : il suit donc une
  surcharge du candidat d'un palier, et deux paliers sur un même candidat partagent un alias :

  | Alias              | Candidat (modèle, effort) | Paliers                |
  | ------------------ | ------------------------- | ---------------------- |
  | `sf-k3-low`        | `k3`, `low`               | `light`                |
  | `sf-k3-high`       | `k3`, `high`              | `edit`                 |
  | `sf-k3-1-pro-high` | `k3.1-pro`, `high`        | `build`, `fix`, `plan` |
  | `sf-k3-1-pro-max`  | `k3.1-pro`, `max`         | `terminal`             |

- **sf n'écrit jamais votre configuration Kimi Code.** Votre `~/.kimi-code/config.toml` (ou `$KIMI_CODE_HOME/config.toml`) contient vos identifiants et votre pool, et vous appartient. Le CLI ne fait
  que le **lire**, pour connaître les noms des clés de `[secondary_model.models]` et, quand un extrait en a besoin, le `provider`, le `max_context_size` et les `capabilities` de votre entrée du même
  modèle ; il ne lit jamais une valeur comme une `api_key` dans ce qu'il imprime. Quand un alias manque à votre pool, `sf agents route` imprime sur stderr le TOML à coller, et `sf agents enable`,
  `replace` et `refresh` disent la même chose dans un avertissement (et dans `report.warnings` de `--json`). L'extrait donne d'abord les tables `[models.<alias>]`, car une clé du pool qui ne pointe
  vers aucune entrée fait échouer Kimi Code au démarrage, puis les lignes à ajouter **sous votre table** `[secondary_model.models]` existante, jamais un second en-tête. Un pool que vous n'avez pas
  encore déclaré reçoit les tables `[secondary_model]` et `[secondary_model.models]` en entier, avec un espace réservé pour le `default_model`, qui doit être l'une de ses clés. Une configuration
  illisible (pas un fichier, pas du texte UTF-8, plus de 1 Mio) est `unknown` : la route nomme quand même l'alias, et l'extrait s'imprime comme si rien n'était déclaré. Si
  `[secondary_model].default_effort` est défini, il l'emporte sur l'effort de chaque alias, et le CLI le dit. Avec un pool d'une seule entrée, Kimi Code n'annonce pas du tout le paramètre `model`.
- **Des worktrees ouverts avec git, comme Codex.** Le profil dit `worktrees: manual` : une session Kimi Code dont la délégation est `allowed` ouvre un worktree par ticket avec git (`git fetch origin`,
  puis `git worktree add <chemin> -b <branche> origin/<workingBranch>`) et y confie le ticket à son agent `sf-<palier>` ; chaque agent de palier Kimi porte donc la même ligne de livraison de ticket
  entier que ceux de Claude Code et de Codex. C'est décidé à partir des données du profil, sans branche pour Kimi Code dans le moteur de rendu. Jusqu'à #1332, le profil disait `worktrees: none` et une
  session Kimi construisait les tickets dans le checkout courant, ce qui changeait la branche d'un checkout qu'une autre session partageait.
- **Non vérifié dans une vraie session.** Le profil garde `runtime: not-checked` : que Kimi Code résolve `subagent_type: "sf-<palier>"` et respecte l'alias d'un appel est déclaré d'après sa
  documentation, non vérifié ici.
- **Pas de hook.** Kimi Code lit ses hooks dans la configuration de l'utilisateur seulement, jamais dans le projet : le harness n'installe donc ni garde ni hook de capture. `sf status` dit
  `kimi guard unavailable (…)` et `kimi capture unavailable (… ; record its delegations with sf agents outcome record)`. Les gardes propres au CLI refusent toujours une échappatoire ; rien n'empêche
  un agent d'en poser une avant d'y arriver.
- **Pas de worktree natif.** Kimi Code n'a pas d'outil de worktree que le harness utilise : la session ouvre donc le worktree elle-même et donne son chemin au délégué (`limitations.worktrees`). Une
  route refusée ou en échec n'envoie jamais la session vers le CLI d'un autre hôte (voir [Livraison déléguée des tickets](#livraison-deleguee-des-tickets-sf-agents-delegation)).
- **Enregistrement à la main.** Une délégation à Kimi s'enregistre avec `sf agents outcome record --provider kimi …` (hôte `manual` : évaluée dans le rapport, elle ne déplace jamais le routage), et
  ses modèles ne sont pas valorisés tant que le projet ne déclare pas de prix dans `modules.harness.routing.adjust.prices`.
- **Identité.** L'agent est `kimi`, déclaré explicitement (`sf agents enable kimi`). Aucun chemin ne l'infère d'un nom de modèle, et `kimi-code`, `moonshot` ou `k3` sont refusés comme non enregistrés.
  `kimi-code` (et `Kimi`, `kimi_code`) est refusé avec `Did you mean kimi?` : un hôte qui nomme une session Kimi Code `kimi-code` apprend l'identifiant enregistré par le refus ; `moonshot` et `k3`
  n'ont aucune suggestion.

Un CLI antérieur à cette release ne connaît pas `kimi` comme agent routé : il refuse `sf agents route --provider kimi` et `sf agents outcome record --provider kimi`, et lit une ligne du registre dont
le fournisseur est `kimi` comme une ligne invalide, qu'il ignore et compte. Mettez à jour le CLI de chaque clone qui partage un registre avant d'y enregistrer des délégations Kimi.

### Agents de palier

Le harness traduit la grille en un sous-agent par palier pour chaque agent de développement déclaré que la grille route et dont le profil déclare des agents de palier : une délégation peut ainsi
choisir un palier moins cher par son nom.

| Agent         | Fichier                          | Modèle et effort                                                                                         |
| ------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `claude-code` | `.claude/agents/sf-<tier>.md`    | frontmatter `model` et `effort`                                                                          |
| `codex`       | `.codex/agents/sf-<tier>.toml`   | `model` et `model_reasoning_effort`                                                                      |
| `kimi`        | `.kimi-code/agents/sf-<tier>.md` | Aucun dans le fichier : l'appel passe l'alias que nomme `sf agents route` (voir [Kimi Code](#kimi-code)) |

Chaque description liste les types de tâche que sert le palier et le palier à utiliser pour chacun des autres : `sf-fix` sert `bug-fix` et `review`, et renvoie `scoped-edit` vers `sf-edit`. Les
fichiers suivent le routage du manifeste ; un déplacement que l'ajustement automatique a fait dans ce clone reste local tant qu'il n'est pas promu. Chaque agent demande aussi à son délégué de terminer
par la ligne `SF-DELEGATION` (voir [Délégations mesurées](#delegations-mesurees-et-routage-ajuste)). Une surcharge change le modèle ou l'effort d'un agent de palier ou ajoute un palier propre au
projet, et un palier qui ne sert plus aucun type n'a pas de fichier. Un fichier de sous-agent doit porter un effort que son hôte sait exécuter : une surcharge refuse donc `minimal` et `ultra` pour
Claude Code, `minimal` pour Codex et tout autre effort que `low`, `high` et `max` pour Kimi Code.

Les agents de palier sont suivis par hash comme les autres dépôts d'agents. `sf agents enable`, `replace`, `refresh` et `sf update` réécrivent un fichier intact, et laissent en place un fichier
modifié à côté d'un fichier `.saasfoundry.new`. Un harness géré sans liste `agents` reçoit les agents de palier de Claude Code lors de `sf update`. Aucun dépôt n'est jamais supprimé : un agent retiré,
ou un palier qui ne sert plus aucun type, garde son fichier jusqu'à ce que vous le supprimiez. Un projet adopté n'en reçoit aucun. [`sf status`](./sf-status.md#agents-de-palier) compare chaque agent
de palier à ce qu'un refresh écrirait et signale d'un `warn` celui qui manque, qui a été modifié ou qui est périmé, avec la commande qui le corrige.

Claude Code choisit un sous-agent d'après sa description. Codex délègue quand vous le demandez ou quand les instructions le prévoient, et ne lit les `.codex/agents` d'un projet qu'une fois ce projet
approuvé (trusted). Kimi Code lit les `.kimi-code/agents` du projet (relisez-les comme un script d'un dépôt que vous ne connaissez pas : un fichier d'agent est de la configuration de prompt) ; sa
description dit que le modèle est choisi par l'alias que passe un appel, et son `whenToUse` liste les types de tâche que sert le palier. Un format de fichier et une liaison de modèle vont ensemble :
`kimi-md` n'écrit aucun modèle et déclare donc `modelBinding: call-alias`, et le registre refuse un profil qui associe un format à l'autre liaison.

L'onboarding local de Kimi Code (`sf agents enable kimi`, portée par défaut) écrit les six fichiers comme fichiers non suivis et exclus, et laisse intacts tous les fichiers suivis et le manifeste ; le
texte de `AGENTS.md` qui mentionne l'alias est statique, il ne dépend donc pas de l'agent qu'un clone a déclaré. `--scope shared` écrit les mêmes fichiers pour relecture et consigne leurs références
dans le manifeste.

Les instructions générées le prévoient. Quand une étape du workflow nomme un type de tâche (`exploration` pour l'analyse, `review` pour la revue contradictoire, `scoped-edit` ou `multi-file-feature`
pour une sous-tâche déléguée), elles demandent à chaque agent de lancer `sf agents route --task <kind> --provider <current-agent>` (avec `--ticket <n> --record` quand la délégation est mesurée) et de
déléguer à l'agent `sf-<palier>` indiqué, sans nommer de modèle. Une sous-tâche confiée à un palier moins coûteux précise ses fichiers, son résultat attendu et sa vérification ; si elle ne le peut
pas, elle est découpée ou reste dans la session. Un agent sans candidats de routage, ou qui ne peut pas déléguer, exécute l'étape lui-même.

## Livraison déléguée des tickets (`sf agents delegation`)

La session conversationnelle reste l'interlocutrice du développeur : elle rédige le SRS, crée et trie les tickets, planifie, coordonne le travail en cours et relit le résultat. Qu'elle construise
aussi les tickets elle-même est une décision du développeur, demandée une seule fois par projet et enregistrée dans le manifeste :

```bash
sf agents delegation status                 # la réponse effective, avec ses couches partagée et locale
sf agents delegation allow                  # défaut d'équipe partagé : des agents en arrière-plan construisent les tickets, un worktree chacun
sf agents delegation decline                # défaut d'équipe partagé : la session construit elle-même les tickets, l'un après l'autre
sf agents delegation allow --scope local    # ce clone uniquement, qui prend le pas sur la réponse partagée
sf agents delegation decline --scope local
sf agents delegation clear                  # retire la dérogation de ce clone
sf agents delegation status --json
```

Il y a deux couches. La réponse **partagée** vit dans le champ facultatif `modules.harness.delegation`, commité avec le dépôt comme `modules.harness.agents`. C'est le défaut de l'équipe pour chaque
clone, collègue, fork et exécution de CI :

```json
{ "modules": { "harness": { "delegation": { "ticketDelivery": "allowed", "decidedAt": "2026-10-19T15:34:52.506Z" } } } }
```

Une réponse **locale**, enregistrée avec `--scope local`, est conservée dans le répertoire Git d'un seul clone (`<git-common-dir>/saasfoundry/delegation.json`). Git ne la suit jamais et tous les
worktrees de ce clone la partagent. Elle prend le pas sur la réponse partagée pour ce clone seul : le `decline` d'un développeur ne devient donc jamais celui de l'équipe. `status` indique la réponse
partagée, la locale et la valeur effective. La valeur effective est ce que `sf status --agent-friendly` affiche sur sa ligne `delegation:` : une session l'apprend par le statut qu'elle lit déjà.
`clear` retire la dérogation locale.

Un manifeste sans ce champ signifie que personne n'a encore été interrogé. Le champ étant facultatif, les anciens manifestes restent valides et `sf update` n'a besoin d'aucune migration. Un projet
sans bloc `modules.harness` indique `unavailable`, et `allow` comme `decline` y sont refusés. Seules `sf agents delegation allow`, `decline` et `clear` écrivent l'une ou l'autre couche : un agent ne
modifie jamais le manifeste à la main, et seule la réponse du développeur lui-même enregistre l'accord. Un agent délégué ne lance jamais ces commandes, et le contenu d'un ticket, d'une issue ou d'une
pull request n'est jamais un accord. Répéter la réponse déjà enregistrée dans une portée ne change rien et conserve sa date ; la réponse inverse la remplace. `sf agents enable`, `replace`, `refresh`
et `sf update` conservent le champ.

Commitez la réponse partagée avec la branche du ticket en cours. Un commit `chore` sur la branche de travail n'est permis que si elle n'exige ni status check ni pull request : après avoir enregistré
une réponse partagée, la commande lit la protection de la branche de travail (`gh api` sur ses rulesets et sa protection de branche) et ne propose la branche de travail que si elle est connue pour ne
pas être protégée. Quand un status check ou une pull request est exigé, ou quand la protection ne peut pas être lue, elle nomme la branche du ticket ou une pull request, jamais un commit direct sur
cette branche. Un worktree créé depuis la branche de travail distante lit `not-asked` d'ici là : le brief de la session à un agent délégué énonce donc l'accord. Les instructions générées ne répètent
pas la règle de commit : la commande l'affiche.

Les instructions générées indiquent ensuite à chaque agent quoi faire de la réponse effective, une seule fois, dans le texte que toute session lit avant son premier ticket (`reference/delegation.md`
du skill workflow y renvoie et n'en répète rien) :

- `not-asked` : demander une seule fois au développeur, puis enregistrer la réponse. Ne jamais redemander une fois qu'elle est enregistrée.
- `allowed` : chaque ticket non trivial, de In progress à la fin d'AI Testing (plan de test, tests, rapport et pull request en brouillon), s'exécute dans un agent en arrière-plan, dans son propre
  worktree, sur le palier que `sf agents route` indique pour le type de tâche du travail. L'agent qui reçoit un ticket le construit lui-même et ne le confie jamais à un autre. La session continue de
  dialoguer avec le développeur et ne bascule jamais vers le codage d'un ticket en cours de livraison. Une demande qui arrive entre-temps et ne fait pas partie du ticket en cours devient un ticket à
  part, confié à son propre agent. Un changement trivial reste dans la session : un seul fichier connu, environ 20 lignes au plus (une coquille, une valeur de configuration, une ligne de
  documentation), dans un worktree à lui. Il ne justifie ni une délégation ni une installation de dépendances.
- `declined`, ou un agent qui ne peut ni déléguer ni travailler en arrière-plan : la session construit les tickets l'un après l'autre et le dit explicitement.

L'accord couvre la livraison des tickets, et rien d'autre. Tout autre flux d'écriture parallèle est d'abord proposé au développeur, dont la réponse précède le démarrage des rédacteurs.

Chaque ticket se construit dans un worktree à lui, quel que soit celui qui le construit et même pour un changement trivial, et le checkout principal reste sur la branche de travail : aucune session
n'en change la branche ni n'y déplace les changements non commités d'un autre (voir [Le checkout principal](#le-checkout-principal)). Un hôte `native` (Claude Code) ouvre le worktree pour son délégué
; un hôte `manual` (Codex, Kimi Code, Gemini CLI, Qwen Code, generic) l'ouvre avec git et donne son chemin au délégué. Un profil sans worktree (`worktrees: none` ; aucun profil enregistré ne le
déclare aujourd'hui) livre les tickets dans la session, l'un après l'autre, chacun dans un worktree qu'il ouvre avec git, et ne délègue que des sous-tâches ; les instructions générées le disent de
façon statique, quels que soient les agents que déclare le projet.

Une route refusée ou en échec n'est jamais contournée. Quand `sf agents route` refuse un agent, ou qu'une délégation ne peut pas démarrer, l'étape s'exécute dans la session ; la session ne lance
jamais le CLI d'un autre agent de code (`claude`, `codex` ou tout autre), ni une session en arrière-plan d'un autre hôte, pour déléguer malgré tout : une telle session n'est ni routée, ni enregistrée,
ni gardée par le harness. Les instructions générées et la skill de workflow énoncent cette règle, qui vaut donc pour tous les agents et ne dépend pas de ceux qui sont déclarés.

Un agent délégué ne fusionne jamais et, sur un ticket qui passe par Human Testing, ne lance jamais `ready-pr` : il s'arrête au rapport vert avec la pull request en brouillon, et c'est le développeur
qui la sort du brouillon. La session recueille les retours de Human Testing et confie un défaut, ou le travail d'IA que la validation laisse (tests de non-régression, suites), à l'agent propre au
ticket, dans le même worktree ; celui-ci remet le ticket en AI Testing. Un défaut trouvé en revue repart de la même façon. Sur un ticket complexe, la session mène elle-même la phase Examine. Le prompt
de l'agent de palier porte les mêmes limites : l'agent n'est pas invité à faire ce que son propre prompt lui interdit.

La branche d'un ticket délégué est celle que l'agent nomme, sauf si l'hôte la nomme avant lui. `isolation: "worktree"` de Claude Code place l'agent sur `worktree-agent-<id>` ; l'agent garde cette
branche locale et pousse son travail vers la branche du ticket (`git push origin HEAD:feature/<N>-<description>`). `create-pr` accepte ce checkout quand origin porte la branche du ticket sur le commit
du `HEAD` local : elle la trouve seule quand c'est la seule dans ce cas, ou la prend de `--head <branche>`. Une branche absente d'origin, poussée mais en retard sur `HEAD`, ou appartenant à un autre
ticket est refusée. Le brief à l'agent nomme la branche du ticket, pour qu'il puisse passer `--head`. Voir
[Intégration GitHub](../workflow/github-integration.md#commandes-pr-sur-une-branche-nommee-par-lhote).

La session lance `ready-pr <ticket>` et `draft-pr <ticket>` depuis le checkout principal, sur la branche de travail, jamais depuis le worktree de l'agent : hors de la branche du ticket, elles trouvent
sur GitHub la seule pull request ouverte du ticket d'après la convention de branches, refusent en listant les candidates quand plusieurs correspondent (`--pr <numéro>` en choisit une), et vérifient
son commit de tête contre origin et la porte de CI locale. Voir [Intégration GitHub](../workflow/github-integration.md#ready-pr-et-draft-pr-depuis-le-checkout-principal).

Le type de tâche de la livraison est dimensionné selon le travail. Le profil de complexité du ticket le déclare (`steps.execute.taskKind`), et il est toujours résolu avec `sf agents route`, jamais en
nommant un modèle :

| Ticket                                                                            | Type de tâche de la livraison                                              |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `bug` dont le ticket ou le tri nomme déjà les fichiers à changer (deux au plus)   | `scoped-edit`                                                              |
| tout autre `bug` : les fichiers ne sont connus qu'après le diagnostic             | `bug-fix`                                                                  |
| `low` (il peut toucher jusqu'à trois fichiers ; la livraison reste `scoped-edit`) | `scoped-edit`                                                              |
| `medium`, `complex`                                                               | `multi-file-feature`, une fois découpé (la planification reste en session) |

Une tâche bien délimitée atteint donc le palier économique `edit` plutôt que le modèle de la session, un bug à diagnostiquer le palier `fix`, et une fonctionnalité répartie sur plusieurs fichiers le
palier `build`. Les mêmes instructions de projet s'appliquent à tout agent de code qui lit `AGENTS.md`.

## Délégations mesurées et routage ajusté

La grille est un a priori construit à partir de benchmarks publics. Les délégations du projet la corrigent : chaque délégation routée enregistre ce qu'elle a coûté et si elle a fait le travail, et le
routage déplace de lui-même un type de tâche, dans des bornes déclarées, chaque déplacement et chaque maintien étant journalisés avec leurs preuves, visibles et réversibles. Un type de tâche monte
d'un palier après des échecs répétés. Il ne descend qu'après qu'un palier moins cher, essayé sur une part bornée de ses exécutions, continue de réussir. Ce qui décide d'une descente est le coût de
livraison du travail, échecs compris, jamais le prix d'un appel.

### Le registre

Le registre est un fichier en ajout seul situé dans le **répertoire Git commun** du clone, `<git-common-dir>/saasfoundry/delegations.jsonl`. Tous les worktrees du clone (un par ticket délégué) y
écrivent et en lisent le même historique. Git ne le suit jamais, le fichier a le mode 0600 et les ajouts sont verrouillés. Il contient cinq sortes de lignes :

- une **exécution**, une par arrêt d'un agent : le type de tâche, l'agent de code, le palier et le candidat (modèle et effort) qui ont tourné, le ticket et sa complexité, le temps actif, les jetons
  (entrée, sortie, lecture et écriture du cache), le **coût**, le résultat et les contrôles exécutés, et si l'exécution était un essai. Les codes de résultat et de contrôle sont ceux de la
  [bibliothèque de calibrage d'exécution](/fr/guide/execution-calibration). L'identifiant d'agent de l'hôte est stocké haché, jamais tel qu'il est arrivé ;
- une **route**, émise par `sf agents route --record` (voir plus bas), qui dit ce qu'est une délégation ;
- un **détail** : ce que le résultat d'outil de l'hôte ajoute à une exécution, sa propre mesure de la durée, le modèle résolu, un statut en échec ou interrompu ;
- un **signal** : un verdict ultérieur (`rework`, `human-defect`) rattaché à une exécution ou à un ticket ;
- un **statut** : un ticket a changé de statut, ce qui permet au rapport de chronométrer un ticket.

Le coût est les jetons multipliés par un prix, conservé en décimal exact et arrondi une seule fois vers le haut à 1e-8 USD. Le CLI livre une liste de prix datée pour les modèles Claude de la grille
(`src/harness/model-prices.json`, avec sa source et sa date). Un prix est une chaîne décimale strictement positive. Haiku 5.5 facture plus cher un prompt de plus de 100K jetons : un modèle qui a un
tel tarif est donc chiffré **appel par appel**, chaque appel selon la taille de son propre prompt (jetons d'entrée, de lecture et d'écriture du cache), d'après la transcription ; une exécution dont
les appels sont inconnus est `partial` : elle garde ses jetons, n'a pas de coût et reste hors des comparaisons de coût. Un modèle sans prix publié, comme les modèles Codex, est **sans prix** : ses
exécutions comptent pour la fiabilité mais n'ont pas de coût tant que le projet n'en déclare pas un dans `modules.harness.routing.adjust.prices` (USD par million de jetons, avec éventuellement un
tarif `longPrompt`). Un coût n'est jamais deviné.

Une mesure absente est enregistrée comme **inconnue**. Une délégation sans verdict est `outcome-unknown`, une exécution sans route n'a pas de type de tâche, et une exécution annulée ou interrompue ou
un candidat indisponible ne disent rien du palier. Toutes sont conservées et affichées mais **censurées** : elles ne comptent jamais comme un succès ni comme un échec. Une exécution en échec ou
expirée est un échec d'exécution.

Les écrivains prennent un verrou qui nomme son détenteur (`pid:jeton`). Il n'est brisé que lorsque ce pid n'existe plus, et n'est libéré que par l'écrivain qui l'a pris. Un écrivain qui ne l'obtient
pas à temps dépose sa ligne dans un tampon à côté du registre (`delegations.spool/`) : tous les lecteurs la voient aussitôt et le prochain écrivain l'ajoute, si bien qu'un enregistrement n'est pas
perdu parce qu'un hook a été tué.

### Enregistrements de route

Ce qu'un délégué dit de lui-même n'est pas cru. La session émet la vérité quand elle route le travail :

```bash
sf agents route --task multi-file-feature --provider claude-code --ticket 1035 --complexity complex --nature user-facing --record
# multi-file-feature → build (shipped) claude-code: claude-sonnet-5-5, effort xhigh — … route=0a1b2c3d4e5f60718293
```

`--record` écrit dans le registre un **enregistrement de route** (le type, le palier, s'il s'agit d'un essai, le ticket, la complexité et la nature) et affiche son identifiant (`routeId` avec
`--json`, `routeVersion: 2`). La session met `route=<id>` dans le brief et le délégué le reprend. La capture prend le type de tâche, le palier, le ticket et l'indicateur d'essai **dans
l'enregistrement** : un délégué ne peut ni nommer son propre type ni se déclarer essai. Une exécution sans identifiant, avec un identifiant que personne n'a émis, émis pour un autre palier ou un autre
agent, ou déjà utilisé par un autre agent, est conservée et censurée, et dit pourquoi dans ses références de preuve. Lire une route sans `--record` n'enregistre rien.
`--retry-of <id de route ou d'exécution>` route la reprise **un palier au-dessus** de celui qu'a utilisé la délégation précédente, jamais en essai, et relie les deux : ce lien, et rien d'autre, dit
que l'exécution précédente n'a pas fait le travail. Une reprise garde l'agent de code et le type de tâche de la délégation qu'elle suit, et tout en haut de l'échelle la commande dit qu'il ne reste
aucun palier plus fort au lieu de répondre à nouveau le même.

L'enregistrement est aussi une **réservation**. Un essai qu'il accorde garde sa place dans la part d'essais jusqu'à ce qu'une exécution reprenne l'identifiant ou que sept jours passent, et le contrôle
et la réservation ne forment qu'une étape sous le verrou du registre : des routes demandées au même instant ne peuvent donc pas être toutes des essais. Une route que personne n'a reprise dans ces sept
jours est **expirée** : une exécution qui la reprend ensuite est conservée et censurée (`route-expired`), car son type et son indicateur d'essai ne sont plus fiables. Un agent qui a déjà utilisé la
route n'expire jamais, si bien qu'un agent repris qui rend la main plusieurs jours plus tard garde son verdict. Un enregistrement vaut pour un seul agent de code : passez `--provider` quand plusieurs
sont déclarés.

**Le ticket dit sa complexité.** La forme ci-dessus nomme `--complexity` et `--nature`, mais celle que la plupart des sessions recopient ne le fait pas :
`sf agents route --task <kind> --provider <agent> --ticket <n> --record`. Pour une valeur que les options n'indiquent pas, la commande lit les étiquettes du ticket
(`complexity: <bug|low|medium|complex>`, `nature:<user-facing|internal|bundled-pr>`) par le CLI d'outil que le workflow utilise lui-même (`.claude/skills/sf-tool-<tool>/<tool>-cli.sh get-labels <n>`,
puis la copie de `.agents/skills` pour un projet Codex seul), et les enregistre. Une option explicite l'emporte, et un ticket dont la complexité et la nature sont toutes deux données n'est pas
interrogé. La sortie texte dit d'où vient chaque valeur (`Ticket #1105: complexity medium (from the ticket label), nature internal (from the ticket label).`, au-dessus de la ligne de route, qui reste
la dernière), et `--json` ajoute `complexity`, `complexitySource`, `nature` et `natureSource` (`flag`, `label` ou `null`).

La lecture ne retient jamais une délégation. Elle a lieu avant la prise du verrou du registre, dure dix secondes au plus et échoue en laissant passer : un outil dont le CLI n'a pas de `get-labels`
(seul GitHub Projects en a un aujourd'hui), l'absence de CLI d'outil, un `gh` hors ligne, un délai dépassé ou un ticket sans étiquette de complexité n'enregistrent aucune complexité et le disent une
fois sur stderr, en nommant la cause et l'option à passer : `Warning: the complexity of #1105 could not be read (<why>): the route record carries none; pass --complexity <level>`. Un ticket sans
étiquette `nature:` est le ticket par défaut (user-facing), pas une lacune, et n'est pas signalé. Rien n'est lu sans `--ticket`.

### Ce que rapporte le délégué

L'hôte sait ce qu'une délégation a coûté ; seul le délégué sait s'il a fait le travail. Chaque agent de palier termine son dernier message par une ligne :

```text
SF-DELEGATION: pass route=0a1b2c3d4e5f60718293 checks=type-check,automated-tests
```

`pass` signifie que le contrôle nommé par le brief a été exécuté et satisfait ; `fail` qu'il a échoué ou que le résultat est incomplet. Les contrôles sont les codes de la bibliothèque de calibrage :
`self-review`, `type-check`, `automated-tests`, `affected-tests` (les tests que le changement touche, lancés pendant le travail), `integration-tests`, `independent-review`, `security-tests` ; le
prompt les liste, car un délégué à qui on ne les donne pas écrit du texte libre. Un `pass` qui ne nomme aucun contrôle, ou seulement `self-review`, est enregistré comme inconnu. La ligne est la
**dernière ligne non vide du message hors d'un bloc de code**. Les blocs de code sont suivis sur **tout le message** depuis sa première ligne (un bloc ne se ferme qu'avec la même marque, au moins
aussi longue, et rien après), quelle que soit la longueur du message : un exemple cité plus haut ou un long bloc de code ne peut pas décider du verdict. Toute autre clé de la ligne (`kind=`,
`ticket=`, `trial=`) est ignorée. Un message sans cette ligne est un résultat inconnu, et le délégué la réclame une fois (section suivante).

### Arrêts intermédiaires

Un délégué qui termine un tour pendant qu'une tâche qu'il a lancée en arrière-plan tourne encore (une suite de tests, un hook de commit, `molten ci run`) n'a pas fini : l'hôte le réveille quand la
tâche rend compte, et la délégation se termine à un arrêt ultérieur. Chaque agent de palier a pour consigne d'attendre ses propres tâches (sur Claude Code, l'outil Monitor avec une boucle `until`) et
de ne jamais écrire son dernier message pendant que l'une d'elles tourne. Un tour qui se termine malgré tout est un **arrêt intermédiaire**, et la capture l'enregistre sans résultat :

- **Claude Code** liste les tâches d'arrière-plan de la session dans chaque payload `SubagentStop` (`background_tasks` : id, type, statut). Cette liste est celle de la session, avec les shells et les
  moniteurs de tous les délégués qui tournent à côté de celui-ci et l'agent qui s'arrête lui-même : la capture ne garde que les tâches en cours que la transcription de l'agent a lancées (un shell
  lancé en arrière-plan, un moniteur, un sous-agent lancé en arrière-plan). Quand l'une d'elles tourne encore, l'arrêt est intermédiaire.
- **Sur tout hôte**, un délégué qui termine un tour par `SF-DELEGATION: pending route=<id>` dit la même chose. C'est le seul signal sur Codex, et sur une version de Claude Code dont le payload n'a pas
  de liste de tâches.

Un arrêt intermédiaire garde son coût et sa route, porte les références de preuve `interim-stop` (et `background-work-running` quand la liste des tâches l'a montré) et, quand le délégué a tout de même
écrit un verdict, `interim-verdict-<pass|fail>` : un fait, jamais le résultat. La ligne ne lui est jamais réclamée. Tant qu'un arrêt intermédiaire est le dernier d'un agent, la délégation est
censurée, y compris un verdict donné par un arrêt antérieur, et `sf agents routing report` la compte à part. Son arrêt final porte le verdict qui compte. Une CLI antérieure à ce changement lit une
ligne `pending` comme une ligne manquante et la réclame une fois, comme avant.

Le rapport de routage et l'ajustement lisent le même registre replié ; le 2026-11-13, ils ne divergeaient que dans le temps. L'ajustement tourne après chaque capture, et trois délégations venaient
d'enregistrer un `fail` à un arrêt intermédiaire : `bug-fix` est monté d'un palier sur « 3 failures in the last 10 rated runs », et le `pass` final des mêmes délégations, enregistré plus tard, n'a pas
défait ce mouvement. Un arrêt intermédiaire n'a désormais pas de résultat : ni l'un ni l'autre n'y lit d'échec.

### Réclamer la ligne manquante

Un délégué qui oublie sa ligne de fin était enregistré comme un résultat inconnu puis écarté : personne ne le voyait, et le routage ne pouvait pas apprendre de l'exécution. La capture répond
maintenant au `SubagentStop` d'un tel délégué par une **décision de blocage**, sur Claude Code comme sur Codex : l'hôte laisse le sous-agent continuer et lui remet la raison comme prochaine
instruction.

```json
{
  "decision": "block",
  "reason": "Your final message has no SF-DELEGATION line, so this delegation cannot be measured. Do not redo any work. …\nSF-DELEGATION: <pass|fail> route=<the id from your brief, if it gave one> checks=<codes>"
}
```

Elle ne réclame que si toutes les conditions sont réunies, et jamais deux fois :

- l'événement est un `SubagentStop` d'un agent `sf-<tier>` routé dont le palier est déclaré pour l'hôte, avec un dernier message non vide qui n'a **aucune ligne** (un `pass` qui ne nomme qu'une
  auto-revue a une ligne, il n'est donc jamais réclamé : réclamer à nouveau ne changerait pas le contrôle) ;
- l'arrêt n'est pas [intermédiaire](#arrets-intermediaires) : un délégué dont une tâche d'arrière-plan tourne encore, ou qui a écrit `SF-DELEGATION: pending`, donne sa ligne à son arrêt final ;
- l'hôte ne dit pas qu'il continue déjà à cause d'un hook d'arrêt (`stop_hook_active`) ;
- aucun segment antérieur du même agent ne porte la référence de preuve `asked-for-sf-delegation-line`. Cette garde est la nôtre : elle tient quand l'indicateur de boucle d'un hôte est faux ou absent.

L'arrêt est enregistré d'abord, avec cette référence, pour que rien ne se perde si l'agent ne s'arrête jamais plus. L'arrêt qui répond est le segment suivant du même agent : il se fond dans **une
seule délégation**, avec le verdict et la route de la réponse et le coût des deux arrêts (voir plus bas). Quand le brief a donné un identifiant de route (`route=<id>` dans un prompt utilisateur de la
transcription de l'agent, jamais dans un résultat d'outil) et que l'enregistrement de route accepterait cet agent, la raison le porte comme la ligne exacte à écrire ; sinon elle dit d'utiliser
l'identifiant du brief. Cet identifiant ne fait que remplir la suggestion : la ligne que le délégué écrit est ce qui attribue l'exécution.

### Capture et signaux

`sf agents outcome capture --host <claude-code|codex>` lit la charge d'un hook sur l'entrée standard, ajoute un enregistrement, puis lance l'ajustement sur l'état qu'il vient d'écrire. Il ne fait
jamais échouer l'hôte : ce qui se passe mal une fois les arguments compris se termine par le code de sortie 0. Ne le lancez à la main que pour tester un hook. Il n'écrit rien sur stdout, sauf un objet
JSON quand il réclame sa ligne manquante à un délégué ([ci-dessus](#reclamer-la-ligne-manquante) ; `--json` le porte dans le résultat versionné à la place).

Le hook est une ligne de shell, pas un `sf` nu (ce nom peut être un autre CLI, ou un SaaSFoundry plus ancien sans la commande). Il s'arrête aussitôt, avant le démarrage de Node, sauf si la charge
mentionne un agent `sf-<tier>`, puis lance le CLI que le **projet** résout : `node_modules/.bin/saasfoundryai`, puis son `sf`, puis le build de ce dépôt quand le projet est SaaSFoundry lui-même, puis
`saasfoundryai` dans le PATH. Il sort avec 0, quoi qu'il arrive : un CLI absent ou trop ancien ne dérange jamais l'agent. La **stdout** du CLI parvient à l'hôte (c'est ainsi que la décision y arrive)
et sa stderr est écartée. Un CLI trop ancien pour connaître `agents outcome capture` sort avec un code non nul : le hook écrit alors une ligne sur stderr et une entrée d'étape `cli` dans le journal
des erreurs de capture ci-dessous, au lieu de passer en silence.

Un échec ne se perd pas pour autant. La capture ajoute une ligne à **`capture-errors.jsonl`**, à côté du registre dans le répertoire Git du clone (jamais suivi, partagé par tous les worktrees), pour
une charge illisible, un registre impossible à écrire ou un ajustement de routage sauté, et pour les écarts anormaux (une charge qui n'est pas un objet, un palier que le projet n'a jamais déclaré pour
l'hôte, un résultat d'outil sans identifiant d'agent). Les écarts ordinaires (un événement qui n'est pas une délégation, un agent qui n'est pas un `sf-<tier>`, un lancement en arrière-plan) ne
laissent rien. Une ligne porte l'heure, l'hôte, l'événement du hook, une étape (`payload`, `ledger`, `adjustment` ou `ignored`) et un message d'environ 300 caractères, sans texte de charge ni
identifiant d'agent de l'hôte. Au-delà de 64 Kio le fichier garde ses 200 dernières lignes. `sf status` compte les erreurs des 7 derniers jours (voir [`sf status`](./sf-status.md#erreurs-de-capture))
et `sf agents routing report` aussi. Hors d'un dépôt Git il n'y a pas de journal, et l'échec reste sur stderr.

- **Claude Code.** `SubagentStop` (matcher `sf-.*`, donc les autres sous-agents ne le déclenchent jamais) est l'événement principal : le palier vient de l'agent `sf-<tier>` et les jetons sont
  additionnés sur les appels d'API distincts de la transcription du sous-agent. `PostToolUse` sur l'outil `Agent` est rattaché à l'arrêt par l'identifiant d'agent et ajoute la durée mesurée par
  l'hôte, le modèle résolu et un statut en échec ou interrompu. Les deux vont dans `.claude/settings.json`.
- **Codex.** `SubagentStop` dans le `.codex/hooks.json` suivi par Git, qui conserve les hooks que le projet y a déjà. Les jetons viennent du rollout et restent inconnus quand il ne peut pas être lu.
  Codex n'exécute un hook de projet qu'une fois la couche `.codex/` approuvée et le hook lui-même approuvé (il conserve cette approbation hook par hook) ; rien ici ne peut le voir, donc `sf status`
  dit **declared**, pas appliqué. L'approbation suit le texte du hook : quand `sf update` ou `sf agents refresh` remplace une commande de capture antérieure (celle de la v1.1.0, voir plus bas), il le
  dit, et Codex ignore le nouveau hook tant que vous ne l'avez pas relu et approuvé avec `/hooks`. D'ici là, les délégations Codex de ce projet ne sont pas enregistrées.
- **Autres hôtes.** Pas de hook. La session enregistre à la main avec `sf agents outcome record`, et `sf status` indique que la capture est indisponible, avec la raison que donne le profil de l'hôte.
  Kimi Code est routé et n'a pas de hook : il lit ses hooks dans la configuration de l'utilisateur seulement, ses délégations sont donc toujours enregistrées à la main.

Un agent que la session **reprend** pour lui rendre un résultat émet un nouveau `SubagentStop` avec le même identifiant d'agent. Chaque arrêt est une exécution à part : elle ne compte que les octets
de transcription écrits depuis l'arrêt précédent, se relie à lui, et l'ensemble est une seule délégation. Le dernier arrêt porte le coût et le temps actif de tous, et le dernier verdict est le
résultat. Le **temps actif** d'un arrêt est la somme des écarts entre les événements de sa transcription, chacun plafonné à cinq minutes : le temps mort entre un arrêt et sa reprise n'est pas du
travail ; la durée que l'hôte rapporte pour le premier appel l'emporte quand elle existe.

`sf update` et `sf agents refresh --scope shared` déposent les hooks, fusionnés dans ce que les fichiers contiennent déjà et remplaçant les commandes qu'une version précédente avait écrites : la
commande `sf` nue du premier build, et la ligne de shell que la **v1.1.0** a livrée, qui écartait la stdout du CLI et ne pouvait donc pas porter une décision jusqu'à l'hôte. Les deux sont reconnues à
leur texte exact et remplacées, jamais laissées à côté du nouveau hook ; une copie que vous avez modifiée à la main est la vôtre et reste. `.claude/settings.json` est écrit en entier ou pas du tout.
Activer un agent n'y touche jamais. `sf status` ne dit `enforced` que lorsque le hook est déclaré **et** que le CLI du projet répond à `agents outcome capture --help` ; sinon `declared-not-runnable`,
`declared` (Codex), `outdated` (le hook d'une version précédente) ou `missing`.

```bash
# Un hôte sans hooks, ou une exécution que les hooks n'ont pas vue : affichée dans le rapport, ne déplace jamais le routage
sf agents outcome record --provider claude-code --tier build --kind multi-file-feature --ticket 1035 --outcome pass \
  --model claude-sonnet-5-5 --input-tokens 120000 --output-tokens 9000 --duration-ms 240000 --checks type-check,automated-tests

# Un signal ultérieur rattaché à la même étape ; la ligne d'origine n'est jamais modifiée
sf agents outcome mark 1035 rework                  # la session a dû reprendre ce que l'agent a livré
sf agents outcome mark 1035 human-defect --kind tests --note "wrong default"

# Lancé par workflow-cli.sh update-status, au mieux, pour chronométrer un ticket
sf agents outcome status-event 1035 "In progress"
```

`record` et `mark` écrivent des preuves sur lesquelles le routage agit : le harness ne les pré-approuve donc pas dans `.claude/settings.json`, elles demandent la permission. Il en va de même pour les
formes de `sf agents route` qui écrivent un enregistrement de route : la forme de lecture est pré-approuvée, tandis que `--record` et `--retry-of` figurent sous `permissions.ask`, que l'hôte évalue
avant `permissions.allow`. Une exécution enregistrée à la main a l'hôte `manual` ; elle est notée pour le rapport et **ne déplace jamais le routage**. Un ticket sans `--kind` est marqué sur le type
qui l'a livré (`multi-file-feature`, `scoped-edit`, `bug-fix`, `tests`, `terminal-ci`, le premier dont il a une exécution), jamais sur une `review` ni une exploration ; `--kind` en nomme un autre.

Un succès qui porte un signal compte comme un échec, tout comme celui qu'une exécution ultérieure reliée par `--retry-of` a refait sur un palier supérieur. La session marque `rework` quand elle refait
un travail délégué et `human-defect` quand un défaut revient du test humain ou de la revue.

`workflow-cli.sh update-status` lance `status-event` en arrière-plan après une transition réussie. Il ne bloque jamais, ne fait jamais échouer la transition et n'enregistre rien quand le projet n'a
pas de CLI.

### L'ajustement

`sf agents routing adjust` évalue chaque type de tâche et chaque agent de code pour lesquels le registre contient des exécutions. Les hooks de capture le lancent après chaque délégation enregistrée ;
`--dry-run` décide sans écrire, `--json` affiche les décisions. Seules comptent les exécutions **décisives** : notées, et enregistrées par un hook d'hôte, jamais à la main. Les valeurs par défaut
livrées :

- **Fenêtre.** Les 20 dernières exécutions notées d'un candidat. Les statistiques suivent le candidat (modèle et effort), pas le nom du palier.
- **Monter.** D'un palier après 3 échecs parmi les 10 dernières exécutions notées du candidat sur lequel le type est routé. Cela **ne dépend pas du coût** : la reprise d'un palier défaillant n'est pas
  mesurée, donc le coût attendu de rester est sous-estimé et un test de coût maintiendrait un type sur un palier qui échoue. Les coûts attendus des deux paliers figurent dans les preuves, et un palier
  supérieur dont la durée p95 dépasse `maxDurationMs` est noté dans la règle, sans être obéi.
- **Descendre.** D'un palier une fois que le palier moins cher a 8 succès et aucun échec parmi les exécutions que le routage a **proposées comme essai**, et coûte moins cher pour livrer le travail.
- **Essai.** Le palier moins cher est essayé sur au plus 10 % des exécutions notées du type depuis le début des preuves, routes déjà émises et pas encore enregistrées comprises :
  `(essais + 1) / (exécutions + 1)` reste dans cette part. Un essai en échec laisse ce palier tranquille pendant 14 jours.
- **Planchers.** Un candidat que la grille exclut pour le type (Haiku pour le terminal et la CI) n'est jamais choisi ; la descente s'arrête là.
- **Échelle.** Les paliers dans l'ordre de la grille : `light`, `edit`, `build`, `fix`, `plan`, `terminal`. Les paliers qui partagent un candidat (c'est le cas de la plupart des paliers Codex) ne
  forment qu'un barreau. Un palier propre au projet n'y figure pas. Un type qui revient au candidat livré perd son entrée locale et est de nouveau routé sur le nom de palier livré, même quand ce
  palier partage son candidat avec un autre.

La descente compare le **coût attendu de livraison** d'un candidat, échecs compris. Un échec se paie une fois, au palier supérieur :

```text
E(palier) = c + (1 - s) x E(palier supérieur)        sommet de l'échelle, ou palier supérieur jamais mesuré :  E = c / s
```

avec `c` le coût moyen d'une délégation sur le palier et `s` son taux de succès. Un palier bon marché qui échoue souvent est donc cher. Une descente exige que le palier moins cher coûte moins cher
d'au moins la bande de coût (10 %) ; dans la bande, la durée p95 la plus basse départage, et un palier dont la durée p95 dépasse `maxDurationMs` (facultatif) n'est pas choisi. Un candidat sans
exécution chiffrée n'a pas de coût attendu : un type peut s'en éloigner pour cause de fiabilité, jamais s'y rendre sur le coût. Chaque déplacement consigne le chiffre qui l'a justifié, la fenêtre
comptée, la règle et les exécutions concernées.

Les **maintiens** sont journalisés aussi. Quand l'ajustement examine un type et le laisse où il est (`top-of-ladder` : il échoue sans palier plus fort ; `cheaper-tier-costs-more` ; `tie-not-faster` ;
`unpriced` ; `over-duration-ceiling` ; ou une simple attente de preuves), la raison est écrite une fois dans le journal et conservée jusqu'à ce qu'elle change. `sf agents routing report` les liste et
`sf status` nomme ceux qui disent quelque chose.

Un **nouveau candidat** (un nouveau modèle ou effort dans la grille ou dans un palier du projet) se distingue d'un candidat connu par ceux que l'ajustement a vus la dernière fois qu'il a regardé
l'échelle. Celui qui apparaît sur un barreau voisin du palier routé est essayé à part dans la même part bornée, sous le palier routé comme pour tout palier moins cher, ou **au-dessus** quand il est
plus fort, et il est adopté par la même règle de coût attendu, qui l'accepte alors. Un candidat qui en remplace un autre **sous le même nom de palier** prend ce palier aussitôt : un agent de palier ne
fait tourner qu'un candidat, donc le précédent ne peut pas rester routé. Une mise à jour de la grille conserve l'historique mesuré de tout candidat inchangé et ne rouvre une fenêtre que pour un
candidat modifié.

**Sur quoi reposent les décisions.** Un déplacement s'applique à tous les worktrees du clone, et un agent délégué peut modifier le manifeste de son propre worktree. Les seuils, les prix et les
surcharges qu'une décision utilise sont donc lus dans la **branche de travail commitée**, jamais dans le manifeste présent sur le disque. La branche est nommée par le `.saasfoundry.json` commité sur
la branche par défaut du dépôt distant, puis par celui du commit sur lequel se trouve le worktree (`workflow.workingBranch`) ; si aucun ne la nomme, la branche par défaut du dépôt distant fait foi.
`origin/<branche>` est lue d'abord, puis la branche locale : une branche locale jamais mise à jour ne peut donc pas tenir lieu de celle de l'équipe. Tant que le bloc de routage d'un worktree diffère
de celui qui est commité, `adjust` ne décide ni ne déplace rien et le dit, et `sf agents route` répond d'après le bloc du worktree, pour l'affichage, sans essai. Quand aucun manifeste commité ne peut
être lu (la branche nommée n'est pas récupérée, ou aucun commit du dépôt ne contient encore `.saasfoundry.json`), rien n'est décidé non plus et le refus dit quoi corriger : le manifeste présent sur le
disque ne s'y substitue jamais. Sans branche nommée nulle part, le manifeste commité à `HEAD` est la copie commitée.

### La couche locale, promouvoir et réinitialiser

Les déplacements vivent dans `<git-common-dir>/saasfoundry/routing.json`, à côté du registre : une couche locale avec le déplacement, sa provenance et ses preuves, les maintiens, les candidats vus, et
un journal des 100 dernières entrées (déplacements, maintiens qui ont changé, adoptions). Elle s'applique aussitôt à tous les worktrees du clone et n'est jamais commitée. La résolution donne d'abord
les surcharges partagées du développeur (un type fixé dans `modules.harness.routing` n'est **jamais** changé ni masqué par un déplacement automatique), puis cette couche, puis la grille livrée.

Les fichiers des agents de palier sont suivis par Git et rendus depuis le routage partagé : un déplacement local ne les réécrit donc pas ; `adjust` et `report` disent combien diffèrent, et
`sf agents route` fait foi.

Les worktrees d'un clone partagent ce fichier : deux versions du CLI le lisent souvent, par exemple pendant une livraison qui change le routage. À partir de 1.4.0, un CLI ignore les entrées qu'il ne
connaît pas (un fournisseur, un type de tâche, une clé ou une action du journal écrits par un CLI plus récent, ou une entrée dont il ne lit pas la forme), applique les autres, et nomme ce qu'il a
ignoré sur une ligne `Notice:` dans la sortie d'erreur de `sf agents route`. Quand il écrit le fichier, il y remet ces entrées telles quelles. Seul un fichier qui ne peut pas être la couche (pas du
JSON, ou sans ses sections) est refusé, et un fichier d'une version plus récente de la couche demande de mettre à jour le CLI, pas de supprimer le fichier. Le registre ne fait qu'ajouter des lignes :
une ligne qu'un CLI plus ancien ne sait pas lire est ignorée et comptée, jamais réécrite.

```bash
sf agents routing promote multi-file-feature      # copie le déplacement dans modules.harness.routing, en changement relisible
sf agents routing promote --provider codex        # quand les deux agents ont déplacé le type différemment
sf agents routing reset multi-file-feature        # annule les déplacements automatiques du type
```

`promote` écrit le palier dans `modules.harness.routing.kinds` par le même remplacement atomique, qui détecte les modifications, que `sf agents enable`, retire l'entrée locale et la journalise. Une
surcharge partagée couvre tous les agents : deux déplacements qui diffèrent demandent `--provider`. Un type que le manifeste surcharge déjà est ignoré : le choix du développeur l'emporte. Relisez le
changement, lancez `sf agents refresh --scope shared` pour régénérer les agents de palier et commitez les deux. `reset` remet le type sur le routage partagé ou sur la grille et rouvre ses preuves,
pour que les mêmes exécutions ne le déplacent pas de nouveau à la prochaine capture ; une surcharge partagée n'est pas modifiée.

### Le rapport

`sf agents routing report [--json]` est en lecture seule. Il montre, par type de tâche et palier, les délégations, le nombre censuré, le taux de succès, le coût et la durée p95 et le coût attendu de
livraison, et, par ticket selon la complexité (et la nature), la médiane et le p95 du coût, du **temps actif** des délégations, et du temps **entre le premier In progress et le premier Human testing**
(In review pour un ticket qui le saute), tiré des transitions de statut que `workflow-cli.sh` a enregistrées. Un ticket qui a une délégation sans coût est une borne basse : il est compté à part des
médianes et du p95. Un agent repris est une seule délégation, et le rapport dit combien d'arrêts supplémentaires il a comptés. Il nomme aussi les modèles sans prix, l'état de la capture de chaque
agent, les erreurs de capture des 7 derniers jours (`Capture errors: 2 in 7 days (last 2026-11-06, ledger: …)`, ou `none`), les maintiens et les déplacements locaux que personne n'a promus. `--json`
est versionné (`reportVersion: 2`). `sf status` porte une ligne `routing:` avec la version de la grille et les surcharges du projet, les déplacements non promus, les maintiens notables et l'état de la
capture, et une précondition `tierAgents` pour les agents de palier présents sur le disque (voir [`sf status`](./sf-status.md#agents-de-palier)).

Le rapport dit ce qu'il ne voit pas : les jetons que la session dépense à planifier, discuter et relire ne sont mesurés par aucun hook d'hôte, donc le coût d'un ticket est le coût de ses délégations.
Un ticket est compté dès qu'il a une délégation enregistrée ; le rapport ne sait pas s'il est arrivé à Done, et le temps d'un ticket suppose que les transitions aient été enregistrées dans ce clone.

### Réglages

Tous facultatifs ; les valeurs par défaut s'appliquent à l'omission, donc les anciens manifestes restent valides et `sf update` n'exige aucune migration.

```json
{
  "modules": {
    "harness": {
      "routing": {
        "adjust": {
          "enabled": true,
          "window": 20,
          "escalate": { "failures": 3, "of": 10 },
          "deescalate": { "successes": 8, "failures": 0 },
          "trialShare": 0.1,
          "trialCooldownDays": 14,
          "costBand": 0.1,
          "maxDurationMs": 900000,
          "prices": {
            "gpt-6.1-sol": { "input": "0.30", "output": "1.20", "cacheRead": "0.03" },
            "some-long-context-model": {
              "input": "1.00",
              "output": "4.00",
              "longPrompt": { "abovePromptTokens": 200000, "input": "2.00", "output": "8.00" }
            }
          }
        }
      }
    }
  }
}
```

`enabled: false` arrête les déplacements et les essais ; les résultats restent enregistrés. Les `prices` sont en USD par million de jetons, en chaînes décimales strictement positives ; un `cacheRead`
absent vaut un dixième de `input` et un `cacheWrite` absent 1,25 fois sa valeur. Un bloc `longPrompt` donne les tarifs d'un appel dont le prompt dépasse `abovePromptTokens`.

Une limite demeure : les champs des charges de hooks ont été relevés sur une session Claude Code et une session Codex réelles et sont exercés par ces fixtures, mais les hôtes peuvent les changer.

## Le hook de garde

Un garde-fou du workflow refuse une transition et nomme la suite à donner. Il ne nomme jamais le moyen de le contourner : une échappatoire (`SF_WORKFLOW_BYPASS_*`, `--skip-local-ci`) et le label de
nature qui saute Human testing sont à appliquer par le développeur. `sf agents guard --host <claude-code|codex>` y tient l'agent. C'est la commande d'un hook `PreToolUse` que le harness écrit dans
`.claude/settings.json` (matcher `Bash|PowerShell`, délai de 10 secondes) et dans `.codex/hooks.json` (matcher `Bash`), lors de `sf new`, `sf update` et `sf agents refresh`. Elle lit l'événement
d'outil sur l'entrée standard et affiche la décision de refus de l'hôte, ou rien :

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Refused by the SaaSFoundry guard hook: … Stop, report the guard's refusal to the developer and ask. …"
  }
}
```

Se taire laisse le flux de permissions normal de l'hôte en place : le hook n'autorise jamais un appel, il en refuse un, ou, en mode `warn`, [ajoute du contexte](#les-modes) et laisse le flux en place.
Elle sort toujours avec 0 et laisse passer en cas d'échec. Une charge qu'elle ne sait pas lire (pas du JSON, plus de 1 Mio) laisse l'appel passer et est écrite dans le
[journal des erreurs de capture](#capture-et-signaux), que `sf status` compte. Ne la lancez à la main que pour tester un hook.

**Ce qu'elle refuse.** Pour tout le monde, la session principale comprise :

| Règle                     | L'appel                                                                                                                                                                                                                                                                     |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Variable de contournement | Une affectation `SF_WORKFLOW_BYPASS_<X>=…` devant une commande, dans `export`, `declare -x`, `typeset -x`, `env`, `bash -c '…'` ou `eval`. `SF_WORKFLOW_BYPASS_REASON` seule, et le nom comme simple argument (`grep SF_WORKFLOW_BYPASS_PUSHED_GUARD fichier`), sont permis |
| Saut de la CI locale      | `--skip-local-ci` passé à `workflow-cli.sh` ou à `github-projects-cli.sh`, aussi via `bash <chemin>`. `grep -- --skip-local-ci` est permis                                                                                                                                  |
| Label de nature           | `gh issue edit … --add-label nature:internal\|nature:bundled-pr` (aussi `--add-label=` et une liste de labels), et `gh api` qui en écrit un. Retirer `nature:user-facing`, et lire les labels, sont permis                                                                  |

et, **pour un agent délégué seulement**, c'est-à-dire un événement d'outil avec un `agent_id` (Claude Code l'ajoute à chaque événement émis dans un sous-agent), ou un appel dont le répertoire de
travail, le `cd` ou la cible de `git -C` est sous `.claude/worktrees/` ou `.codex/worktrees/` :

| Règle                        | L'appel                                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------- |
| Consentement à la délégation | `sf agents delegation allow\|decline\|clear`, quelle que soit la façon d'écrire le CLI |
| Pull request prête           | `ready-pr` de l'un ou l'autre script, et `gh pr ready` (pas `--undo`)                  |
| Fusion                       | `gh pr merge`, et `gh api …/pulls/<n>/merge`                                           |
| Nature à la création         | `github-projects-cli.sh create-ticket … --nature internal\|bundled-pr`                 |

Les mêmes appels depuis le checkout principal sont permis : la session et le développeur les lancent. La commande est lue comme un shell la lit : guillemets, `;` `&&` `|` et sauts de ligne,
`bash -c '…'`, `eval`, `env`, heredocs et here-strings sont examinés, sur trois niveaux. Elle ne développe ni `$(…)` dans une chaîne, ni une variable.

### Le checkout principal

Des agents de plusieurs hôtes et le développeur peuvent travailler dans un même dossier, comme plusieurs développeurs sur un même dépôt : chaque ticket se construit dans un worktree à lui, et le
checkout principal reste sur `workflow.workingBranch`. Quand une session a mis de côté (stash) le changement du développeur puis basculé le checkout partagé sur sa branche de ticket, le travail de
l'autre session a changé de branche sous elle (#1332). Pour tout le monde, donc, et **dans le checkout principal seulement** (un worktree lié n'est pas concerné), le hook refuse :

| Appel          | Refusé                                                                                                                                                            | Permis                                                                                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git switch`   | toute branche autre que la branche de travail ; `-c`, `-C`, `--orphan`, `--detach`, `-`                                                                           | `git switch <workingBranch>`, `--help`                                                                                                                     |
| `git checkout` | `-b`, `-B`, `--orphan`, `--detach`, `-`, et un opérande qui peut nommer une branche ou un commit (`fix/12-x`, `HEAD~1`) autre que la branche de travail et `HEAD` | tout ce qui suit `--`, `-p`, `<tree-ish> <chemin>…`, un opérande qui ne peut pas être un nom de branche (`.`, `./x`, `.env`, `src/*.ts`, un chemin absolu) |
| `git stash`    | tout ce qui déplace des changements ou supprime un stash : seul, `push`, `save`, `pop`, `apply`, `drop`, `clear`, `branch`                                        | `list`, `show`, `create`, `store`                                                                                                                          |

`git checkout README` est ambigu (une branche ou un fichier) et il est refusé : le refus dit d'écrire `git checkout -- README` ou `git restore README`. Le refus nomme la commande de worktree à
utiliser à la place, une commande par appel : `git fetch origin`, puis `git worktree add <chemin> -b <branche du ticket> origin/<workingBranch>`.

Le hook distingue les deux par l'entrée `.git` la plus proche du dossier où la commande s'exécute (son dossier de travail, un `cd` ou `git -C`) : un dossier est le checkout principal, un fichier dont
le `gitdir:` pointe dans `<common-dir>/worktrees/<nom>` est un worktree lié. Aucun processus `git` ne tourne. Tout le reste (un sous-module, `--git-dir`, `--work-tree`, `cd ~`, pas de checkout) n'est
pas deviné : l'appel passe. La branche de travail est lue dans le `.saasfoundry.json` le plus proche ; sans elle, tout changement de branche est refusé. La ligne du hook laisse atteindre le CLI à une
charge qui mentionne `checkout`, `switch` ou `stash` ; celle qu'écrivait la v1.3.0 ne le faisait pas, et un rafraîchissement la remplace.

### Une ligne de shell qui n'est pas une commande simple

`AGENTS.md` demande à un agent de s'en tenir à une commande simple par appel de shell. Un hôte ne peut pas analyser une ligne qui enchaîne des commandes, en substitue une dans une autre ou lance un
script en ligne avant son exécution : il demande donc une permission à chaque appel de ce genre, même quand chaque commande qu'il contient est permise, et le développeur est sollicité pour ce que
l'agent aurait pu découper. Après les règles ci-dessus, le hook lit la **forme** de la ligne et refuse ce qui n'est pas une commande simple. Ce n'est pas une échappatoire : le refus demande à l'agent
de réécrire son appel, et il nomme la construction et le découpage à faire (`1. cd apps/site 2. npm install`). Sur Claude Code, il ne lit que l'outil Bash, car une ligne PowerShell se cite autrement ;
sur Codex, il lit les mêmes constructions, et un vecteur d'arguments Codex `bash -lc '<ligne>'` vaut pour sa ligne.

| Construction                 | Refusé                                                                                                                                                | À la place                                                                                                       |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Un enchaînement              | `a && b`, `a; b`, `a \|\| b`, deux lignes dans un appel (`cd dir && cmd` compris)                                                                     | Une commande par appel, dans l'ordre ; donnez le répertoire à la commande (`git -C <dir>`, `npm --prefix <dir>`) |
| Une substitution             | `$(…)`, accents graves, `<(…)` et `>(…)`, au premier niveau, entre guillemets doubles (où le shell les exécute) et dans un heredoc non cité           | Lancez la commande interne dans son propre appel, puis servez-vous de sa sortie dans le suivant                  |
| Une boucle, un groupe        | `for`, `while`, `until`, `if`, `case`, `select`, `{ …; }`, `( … )`, une définition de fonction, en position de commande                               | Un appel par élément, ou une commande qui prend tous les éléments                                                |
| Une tâche en arrière-plan    | un `&` qui ne fait pas partie d'une redirection                                                                                                       | L'option d'arrière-plan de l'hôte (`run_in_background` sur Claude Code)                                          |
| Un script en ligne           | `node -e`, `python3 -c`, `python3 - <<EOF`, `bash -c`, `eval`, un script envoyé dans un shell par un tube, aussi derrière `env`, `timeout` ou `xargs` | Écrivez le script dans un fichier avec l'outil de fichiers, puis lancez le fichier                               |
| Un fichier écrit par heredoc | `cat <<EOF > chemin`, `tee chemin <<EOF`                                                                                                              | Les outils de fichiers (Write, Edit)                                                                             |

Seul ce qui est en position de commande compte : `rg for src`, `git log --grep "if this; then"`, un `;` ou un `&&` entre guillemets, `find … -exec … \;`, `node script.js -e x` et
`python3 -m pytest -c conf` sont des commandes simples. Un tube, une redirection (`2>&1`, `&>`, `> fichier`), un commentaire, un test `[[ a && b ]]` et un heredoc donné à un programme qui ne fait que
le lire (`cat <<'EOF' | wc -l`, `git commit -F - <<'EOF'`) ne sont pas refusés non plus. Une substitution jamais refermée est refusée comme les autres, de même qu'un texte imbriqué sur plus de 24
niveaux, que l'analyseur ne lit pas plus loin.

**L'exception du message de commit, et ce qui a été mesuré.** L'idiome `git commit -m "$(cat <<'EOF' … EOF)"` est une substitution : par défaut il est refusé, avec la consigne d'écrire le texte dans
un fichier et de le passer par `git commit -F <fichier>`. Savoir si Claude Code demande une permission pour lui a été mesuré, sur Claude Code 2.1.325 lancé avec `--permission-prompts none` et la seule
commande autorisée :

| Règle autorisée        | L'appel                                                                              | Résultat                |
| ---------------------- | ------------------------------------------------------------------------------------ | ----------------------- |
| `Bash(git commit:*)`   | `git commit -m "$(cat <<'EOF' … EOF)"`, délimiteur entre apostrophes                 | exécuté, sans demande   |
| `Bash(git commit:*)`   | la même chose avec un `<<EOF` non cité                                               | refusé (aurait demandé) |
| `Bash(gh pr create:*)` | `gh pr create --title … --body "$(cat <<'EOF' … EOF)"`, délimiteur entre apostrophes | exécuté, sans demande   |

Sur Claude Code, le garde laisse donc exactement cette forme tranquille, pour `git commit` et pour `gh pr create` : un mot entre guillemets doubles qui est une substitution et rien d'autre, ne
contenant que `cat <<'DELIM' … DELIM` avec un délimiteur entre apostrophes. Tout ce qui l'entoure, une autre commande dans la substitution, une redirection, un délimiteur non cité ou entre guillemets
doubles, ou un autre programme est refusé. Le cas `gh pr create` va un pas au-delà de la décision consignée sur #1251, qui nomme `git commit` : c'est une entrée de `takesQuotedHeredocArgument` dans
`src/harness/shell-shape.ts`, et la retirer fait refuser aussi cette forme. Codex n'a pas été mesuré : sur Codex la forme est refusée comme toute autre substitution.

#### Les modes

Ce que fait le hook d'une telle ligne est un réglage du projet, `modules.harness.guard.shellShape` dans `.saasfoundry.json` :

| Mode     | Le hook                                                                                                                                                                                                                                                                                       |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `refuse` | Refuse l'appel et nomme le découpage. C'est le défaut : **l'absence vaut `refuse`**, dans un projet neuf comme dans un projet mis à jour depuis une version antérieure. `sf update` n'écrit rien ; il affiche une ligne qui dit ce que fait désormais le garde.                               |
| `warn`   | Ne refuse pas : il affiche le même texte en `additionalContext`, que l'agent lit, et le flux de permissions propre à l'hôte continue, donc un hôte qui demande pour cette ligne demande toujours. Claude Code le prend en compte sur `PreToolUse` (vérifié sur 2.1.325) ; Codex le documente. |
| `off`    | Ne lit pas la forme d'une ligne.                                                                                                                                                                                                                                                              |

Les règles ci-dessus (une variable de contournement, `--skip-local-ci`, un label de nature et, pour un agent délégué, une fusion) s'appliquent dans tous les modes. Le hook lit le manifeste le plus
proche du répertoire de travail de l'appel (le worktree d'un agent a sa propre copie), puis `CLAUDE_PROJECT_DIR`, à chaque appel : un changement vaut donc dès l'appel suivant ; un manifeste illisible
ou une valeur inconnue valent `refuse`.

#### `sf agents shell-guard`

```bash
sf agents shell-guard status
sf agents shell-guard warn
sf agents shell-guard refuse
sf agents shell-guard off
```

`status` affiche le mode et son origine (`recorded in .saasfoundry.json`, ou le défaut) ; `refuse`, `warn` et `off` l'enregistrent comme défaut partagé de l'équipe, dans
`modules.harness.guard.shellShape`. C'est le seul qui l'écrit : il passe par le même remplacement atomique, qui détecte les modifications concurrentes, que `sf agents delegation`, conserve toutes les
autres clés du bloc harness et du bloc guard, n'écrit rien pour le mode déjà enregistré, et dit où commiter le changement (jamais directement sur une branche de travail protégée). Il échoue sur un
projet sans bloc `modules.harness`. `--json` affiche `{ "shellGuardVersion": 1, "shellShape": "warn", "source": "manifest", "changed": true }` (`changed` seulement quand un mode a été enregistré ;
`source` vaut `default` tant que rien ne l'est). Le schéma déclare le bloc et le laisse ouvert à une clé qu'une version ultérieure ajouterait ; un manifeste plus ancien reste valide, sans hausse de
`manifestVersion` ni migration. Le mode qu'utilise un projet est la décision du développeur : un agent ne le change jamais.

**Comment le développeur applique une échappatoire.** Dans Claude Code, `! <commande>` tapé dans la session s'exécute sans passer par l'outil Bash, donc le hook ne se déclenche pas ; sur n'importe
quel hôte, le terminal du développeur fait la même chose. Lancez l'un ou l'autre depuis le checkout principal.

**La ligne du hook.** C'est une ligne de shell, pas un `sf` nu, pour les raisons qui valent pour [le hook de capture](#capture-et-signaux). Elle lit la charge et sort avant que Node ne démarre, sauf
si le JSON brut de la charge mentionne `SF_WORKFLOW_BYPASS_`, `skip-local-ci`, `nature` (quelle que soit la casse), `addLabels`, `delegation`, `ready` ou `merge`, ou l'un des caractères et options
dont une ligne qui n'est pas une commande simple a besoin : `;`, `&&`, `||`, un saut de ligne (`\n` dans le JSON), `$(`, un accent grave, `<<`, `<(`, un `&` d'arrière-plan, une option d'interpréteur
(`node -`, `python … -`, `sh -`, `eval `, `deno eval`) ou un script envoyé dans un shell (`| bash`). Le filtre est volontairement un sur-ensemble : une commande simple, un tube et une redirection ne
paient aucun processus, une charge qui le franchit ne coûte qu'un démarrage rapide de Node, et aucun mot-clé n'est cherché (`for`, `if`), car la description d'un appel est de la prose. Puis elle lance
le CLI que le projet résout : `node_modules/.bin/saasfoundryai`, puis le `bin/sf.js` de ce dépôt quand `dist/` est construit, puis `saasfoundryai` dans le PATH. `bin/sf.js` répond à
`agents guard --host <claude-code|codex>` par une entrée dédiée qui ne charge que le garde (ni commander, ni une autre commande, ni le registre) : un appel refusé coûte un démarrage de Node, quelques
dizaines de millisecondes, là où le CLI complet prend une demi-seconde à une seconde ; toute autre forme (`--help`, un hôte inconnu) est le CLI complet. Sans CLI, ou avec un CLI qui n'a pas
`agents guard`, l'appel passe ; un CLI qui ne l'a pas sort avec un code non nul, et le hook écrit une ligne sur stderr et une entrée d'étape `cli` dans le journal des erreurs de capture, que
`sf status` compte. Un projet mis à jour vers cette version mais qui atteint un CLI plus ancien n'est pas contrôlé sur la forme d'une ligne, et chaque appel qui atteint ce CLI coûte le CLI complet :
mettez-le à jour (`sf status` le dit).

**Les limites, dites franchement.** Le hook est un garde-corps contre le chemin ordinaire que les refus enseignaient, pas une frontière de sécurité.

- Il lit la commande que l'agent a écrite. Un contournement écrit dans un script qui est ensuite lancé, construit par une variable ou décodé à l'exécution n'est pas vu. `update-status` annonce
  toujours chaque échappatoire qu'il honore sur le ticket, et `workflow-cli.sh` et `github-projects-cli.sh` refusent eux-mêmes une échappatoire, `--skip-local-ci` et `ready-pr` quand ils s'exécutent
  dans un worktree délégué.
- Il couvre l'outil Bash (et PowerShell). Un outil MCP GitHub qui ajoute un label n'est pas couvert.
- Claude Code lit ses réglages au démarrage d'une session : une session déjà en cours garde ses anciens hooks. Un développeur peut désactiver les hooks (`disableAllHooks`).
- Codex n'exécute un hook de projet que lorsque la couche `.codex/` et le texte du hook sont approuvés. `sf update` dit quand il a ajouté le hook : relisez-le et approuvez-le avec `/hooks`. Un
  sous-agent Codex ne porte pas d'identifiant d'agent : les règles réservées aux agents délégués s'y appliquent à un appel dans un chemin de worktree reconnu.
- Il lit le texte de l'appel, pas ce qu'un script fait une fois lancé : `node script.js` est une commande simple quel que soit le contenu du script, et un programme qui en enveloppe un autre que
  l'analyseur ne connaît pas (`find … -exec sh -c '…' \;`, `ssh hôte 'a && b'`) n'est pas examiné.
- `sf status` rapporte l'état sur la ligne `routing:` pour chaque agent déclaré, en nommant le CLI qu'atteint le hook quand celui-ci ne sait pas l'exécuter (`guard enforced`, `guard declared`,
  `guard hook declared but the CLI it reaches (…) cannot run sf agents guard`, `guard hook missing`, `guard not enforced`, et `guard unavailable (<raison>)` pour un outil dont le profil ne déclare
  aucun hook, comme Kimi Code) et en finissant par le mode (`shell shape: refuse`, ou `warn`, ou `off`), et la précondition `guardHook` **échoue** quand ce CLI ne sait pas exécuter le hook, et avertit
  quand il est antérieur au projet ou quand le hook manque ou est périmé (voir [`sf status`](./sf-status.md#le-hook-de-garde)).

## Notes de plateforme

La suite de tests couvre le CLI et les workflows shell générés sous macOS et Linux. Sous Windows, préférez WSL pour retrouver le même environnement. Les commandes Windows natives peuvent fonctionner,
mais la recherche des extensions d'exécutables reste `not-checked` ; utilisez `sf agents doctor` comme indice borné et vérifiez l'hôte réellement choisi.
