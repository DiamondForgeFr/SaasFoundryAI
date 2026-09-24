# Dépannage

Cette page regroupe les erreurs les plus courantes, leur cause et leur résolution. Si votre cas n'y figure pas, ouvrez une issue sur
[`DiamondForgeFr/SaasFoundryAI`](https://github.com/DiamondForgeFr/SaasFoundryAI/issues).

::: tip Commencez par le diagnostic local

Exécutez `sf status --no-network` dans le projet. La commande affiche le manifeste, les modules installés et les préconditions que le CLI vérifie avant d'agir.

:::

## `docker compose up` : réseau `saasfoundry-network` introuvable

**Symptôme**

```text
ERROR: Network saasfoundry-network declared as external, but could not be found.
```

**Cause** — Les projets générés rejoignent un réseau Docker externe commun à l'API, la base et éventuellement MinIO. Le fichier Compose ne crée pas ce réseau.

**Correction**

```bash
docker network create saasfoundry-network
docker compose up
```

Cette création n'est nécessaire qu'une fois par machine.

## `npm install` refuse la version de Node ou npm

**Symptôme**

```text
npm warn EBADENGINE Unsupported engine
```

**Cause** — Le CLI et les projets générés n'ont pas exactement la même version cible :

- le dépôt du CLI exige Node `>=22.0.0`, npm `>=10.0.0`, et son `.nvmrc` fixe actuellement Node `22.15.0` ;
- les applications générées demandent Node `24.19.0`, car elles imposent npm 11.

Utilisez toujours le `.nvmrc` du dépôt dans lequel vous vous trouvez.

**Correction**

```bash
nvm install
nvm use
node --version
npm --version
```

Ne forcez pas une installation contre `devEngines` : les builds et les commandes du projet continueront à refuser une version incompatible.

## `.saasfoundry.json` est invalide

**Symptôme**

```text
✗ Manifest .saasfoundry.json failed schema validation
  /modules/email — must be one of: { "provider": "mailersend", … }, "none"
```

**Cause** — Chaque commande valide le manifeste avec AJV et `schemas/saasfoundry-manifest.schema.json`. Une faute de clé, une ancienne forme ou une édition manuelle incompatible échoue immédiatement.

**Correction**

1. Repérez le chemin JSON indiqué, par exemple `/modules/email`.
2. Comparez la valeur au schéma livré avec la même version du CLI.
3. Si le manifeste provient d'une ancienne version, exécutez `sf update` afin d'appliquer les migrations enregistrées.

Votre éditeur peut utiliser :

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/DiamondForgeFr/SaasFoundryAI/develop/schemas/saasfoundry-manifest.schema.json"
}
```

Le validateur n'invente aucune correction ; il désigne le champ à réparer.

## `sf update` crée des fichiers `*.saasfoundry.new`

**Symptôme**

```text
⚠ Conflict: file modified locally and in template — wrote new version to <path>.saasfoundry.new
```

**Cause** — Votre projet et le template ont modifié le même fichier. Le merge à trois voies préserve votre version et écrit la proposition à côté au lieu de l'écraser.

**Correction**

```bash
diff <file> <file>.saasfoundry.new
# Intégrez les changements voulus dans <file>, vérifiez-les, puis :
rm <file>.saasfoundry.new
```

Le sidecar ne réapparaîtra que si une nouvelle évolution du template rencontre encore un fichier localement modifié.

## Port déjà utilisé — 3000, 5173 ou 5435

**Symptôme**

```text
Error: listen EADDRINUSE: address already in use 0.0.0.0:3000
```

**Cause** — Un autre processus ou conteneur occupe le port. `sf new` choisit désormais le prochain port libre lorsqu'aucune valeur explicite n'est demandée et l'enregistre dans `ports` du manifeste.
Le problème concerne surtout un projet déjà généré dont le port a été pris ensuite.

**Correction**

```bash
lsof -i :3000 # ou :5173, :5435
kill <pid>

docker ps
docker stop <name>
```

Pour remapper, modifiez la variable `PORT` de l'API, `server.port` du frontend ou le mapping de `docker-compose.db.yml`, puis gardez `.saasfoundry.json → ports` cohérent. À la génération, `--db-port`,
`--api-port` et `--web-port` imposent un port ou échouent ; ils ne sont jamais déplacés silencieusement.

## Échec d'un hook Husky

**Symptômes**

```text
⧗ input: feat: my feature
✖ scope may not be empty [scope-empty]
```

ou Prettier reformate des fichiers et demande de les ajouter à nouveau.

**Contrôles**

| Hook         | Contrôle                                                                                                 |
| ------------ | -------------------------------------------------------------------------------------------------------- |
| `commit-msg` | `commitlint` : `<type>(#<ticket>): <description>`                                                        |
| `pre-commit` | format, lint, build, vérification du package et suite Jest                                               |
| `pre-push`   | cohérence RC/tag et vérifications WIP ; les cycles Docker sont lancés explicitement pendant `AI testing` |

**Correction**

- Utilisez un message comme `feat(#317): calibrate SRS intent detector`.
- Si Prettier a modifié les fichiers, ajoutez-les puis créez un **nouveau** commit. Le commit interrompu n'existe pas ; `--amend` modifierait le commit précédent.
- Corrigez les erreurs ESLint ou TypeScript, puis recommencez.
- N'utilisez pas `--no-verify` pour contourner une erreur ordinaire.

## `gh` n'est pas authentifié

**Symptôme**

```text
✗ gh CLI not authenticated. Run: gh auth login
```

**Cause** — L'adaptateur GitHub Projects s'appuie sur le CLI officiel pour lire et modifier le tableau.

**Correction**

```bash
gh auth login
gh auth status
```

Avec plusieurs comptes, utilisez `gh auth switch`. Les tokens sous `~/.config/gh/` ne doivent jamais être versionnés.

## SRS : `srs-cli.sh validate` retourne 5

**Symptôme**

```text
✗ Notion adapter init failed (network or auth)
exit 5
```

**Cause** — L'adaptateur Notion n'atteint pas la page configurée avec le token fourni.

**Correction**

1. Vérifiez le token dans `~/.claude/credentials/notion/<account>.env` ; il doit commencer par `secret_` et ne pas être un placeholder.
2. Partagez explicitement la page `tools.srs.rootPage.url` avec l'intégration Notion.
3. Vérifiez la sortie HTTPS vers `api.notion.com`.
4. Si les identifiants sont corrects mais la configuration de page obsolète, reconfigurez le module ou l'outil SRS par la commande correspondant à votre version du CLI ; ne modifiez pas les fichiers
   de compétence à la main.

Notion couvre la SRS v1. Il ne remplace pas l'adaptateur GitHub Projects pour le cycle complet des tickets.

## `npm run test:docker` dépasse son délai

**Symptôme**

```text
Lifecycle: new-monorepo-full
============================================================
Lifecycle deadline exceeded after 1800s
```

**Cause** — Un cycle effectue une vraie génération ou mise à jour, les installations, les builds de production, le démarrage API/Web, les parcours navigateur et les assertions PostgreSQL. Le scénario
possède un budget interne de 30 minutes ; la CI conserve 40 minutes afin de collecter le teardown et les diagnostics.

**Correction**

```bash
npm run test:docker:scenario -- new-monorepo --depth full
npm run test:docker:list -- --lane normal
```

Consultez les artefacts `lifecycle-timing-*` et les diagnostics d'échec. Les voies stables sont déclarées dans `tests/docker/ci-lanes.ts` et exécutées par `tests/docker/generate-and-build.ts`.

Un échec de teardown ou un test instable doit être signalé avec ses artefacts ; une simple relance réussie ne suffit pas à le faire disparaître du rapport.

## La CI et le poste local n'utilisent pas la même version de Node

**Symptôme** — Les tests locaux passent, mais GitHub Actions échoue sur TypeScript ou le build.

**Cause** — Les workflows fixent une version majeure via `actions/setup-node`, tandis que `.nvmrc` fixe la version de développement du dépôt. Les cycles générés peuvent aussi utiliser Node 24 alors
que les jobs du CLI utilisent Node 22.

**Correction**

1. Inspectez tous les blocs `actions/setup-node` dans `.github/workflows/`.
2. Comparez-les au `.nvmrc` du dépôt concerné et à la matrice du job.
3. Reproduisez localement avec la même version que le job en échec.
4. Mettez à jour la CI ou la configuration locale selon le contrat intentionnel ; n'alignez pas mécaniquement CLI et projets générés, qui peuvent cibler des versions différentes.

## Le drift guard échoue après une modification de compétence

**Symptôme**

```text
FAIL src/__tests__/integration/skill/<name>-drift.spec.ts
expected file content to be byte-equal
```

**Cause** — Les compétences sont dogfoodées. Leur source sous `scaffolds/skills-templates/` et leur dépôt local sous `.claude/skills/` doivent rester identiques lorsqu'ils ne sont pas reliés par un
symlink.

**Correction**

```bash
# Modifiez d'abord la source, puis synchronisez le dépôt local attendu :
cp scaffolds/skills-templates/<name>/<file> .claude/skills/<name>/<file>

npx jest src/__tests__/integration/skill/<name>-drift.spec.ts --no-coverage
```

Respectez les chemins exacts indiqués par le test : pendant la transition multi-agents, certaines sources sont également déposées sous `.agents/skills/` et protégées par le manifeste.

## Pour aller plus loin

- **Commandes** — [`sf new`](/fr/cli/sf-new), [`sf update`](/fr/cli/sf-update), [`sf workflow`](/fr/cli/sf-workflow), [`sf skill`](/fr/cli/sf-skill)
- **Workflow** — [Compétences principales](/fr/skills/core-skills)
- **SRS** — [Tutoriel SRS](/fr/srs/walkthrough)
- **Défaut non couvert** — joignez les sorties de `sf status --no-network` et `sf --version` à l'issue
