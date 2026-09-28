# Skills d'outils

Les **skills d'outils** connectent l'agent de code du projet à des services externes : documentation de bibliothèques, tickets, fichiers de design et espaces de travail. Elles s'installent à la
demande avec `sf new` ou `sf update --add-modules <skill>`. Celles qui nécessitent une authentification utilisent le **système d'identifiants multi-comptes** de SaaSFoundryAI afin de passer d'une
identité personnelle à une identité client ou professionnelle avec une seule commande.

## Deux familles de skills d'outils

| Famille          | Identifiants                 | Changement de compte    | Exemples                                               |
| ---------------- | ---------------------------- | ----------------------- | ------------------------------------------------------ |
| **API publique** | Aucun, niveau anonyme        | Sans objet              | `sf-tool-context7`                                     |
| **Authentifiée** | Jeton ou clé API par service | Oui, via `sf tools use` | `sf-tool-atlassian`, `sf-tool-notion`, `sf-tool-figma` |

Les skills d'outils du workflow forment une troisième famille : une seule est installée par projet selon le tableau configuré. GitHub Projects fournit le workflow V1 complet. Les adaptateurs Jira et
Linear restent expérimentaux. Notion est le backend SRS V1 complet, mais pas un gestionnaire de workflow complet. Consultez le [système de workflow](/fr/workflow/introduction).

## Skills disponibles

| Skill                                     | Usage                                           | Identifiants                  |
| ----------------------------------------- | ----------------------------------------------- | ----------------------------- |
| [`sf-tool-context7`](#sf-tool-context7)   | Documentation récente de React, NestJS, Prisma… | Aucun, API publique gratuite  |
| [`sf-tool-atlassian`](#sf-tool-atlassian) | Tickets Jira et wiki Confluence                 | E-mail Atlassian et jeton API |
| [`sf-tool-notion`](#sf-tool-notion)       | Pages et bases d'un espace Notion               | Jeton d'intégration Notion    |
| [`sf-tool-figma`](#sf-tool-figma)         | Fichiers et métadonnées Figma                   | Jeton d'accès personnel Figma |

## Installer une skill d'outil

Pendant la création du projet :

```bash
sf new
# Lorsque le CLI le demande :
? Select advanced skills
→ [x] sf-tool-context7 [free, no credentials]
→ [x] sf-tool-atlassian
# [Les identifiants Atlassian sont demandés ici]
```

Plus tard :

```bash
sf update --add-modules sf-skill-atlassian \
  --atlassian-email you@example.com \
  --atlassian-api-token $ATLASSIAN_TOKEN \
  --atlassian-domain yourcompany.atlassian.net
```

`sf update` écrit le répertoire de la skill, le référence depuis les instructions du harness et enregistre les identifiants dans `~/.claude/credentials/atlassian/<account>.env` pour cette intégration.
Les secrets restent dans l'espace utilisateur, jamais dans le dépôt.

## Identifiants multi-comptes

Les skills authentifiées utilisent un **répertoire central d'identifiants** — `~/.claude/credentials/<tool>/<account>.env` — permettant de conserver plusieurs comptes côte à côte :

```
~/.claude/credentials/
├── atlassian/
│   ├── work.env           # work@company.com
│   ├── client-acme.env    # mission pour ACME
│   └── personal.env
├── notion/
│   └── personal.env
└── figma/
    └── work.env
```

Le `.saasfoundry.json` de chaque projet indique le compte actif pour chaque outil :

```jsonc
{
  "skillsAccounts": {
    "atlassian": "work",
    "notion": "personal",
    "figma": "work"
  }
}
```

### CLI `sf tools`

```bash
sf tools list                       # Skills installées et comptes utilisés
sf tools accounts atlassian         # Comptes Atlassian existants
sf tools add atlassian client-acme  # Enregistrer un compte et demander les identifiants
sf tools use atlassian client-acme  # Changer le compte du projet courant
sf tools current atlassian          # Afficher le compte Atlassian actif
```

Aucune manipulation du shell ni édition manuelle de fichiers `.env` : une commande suffit pour changer de contexte.

Consultez la [référence de `sf tools`](/fr/cli/sf-tools) pour la liste complète des options.

## `sf-tool-context7`

Cette skill fournit une documentation en temps réel, liée à une version précise, pour plus de 1 000 bibliothèques via l'[API publique Context7](https://context7.com). Elle ne demande **aucun
identifiant** ni compte, dans les limites du niveau anonyme.

Elle se déclenche sur des questions comme « how do I use `useEffect` in React 19? », « show me the Prisma driver-adapter setup » ou sur l'expression explicite « use context7 ».

**CLI** :

```bash
~/.claude/skills/sf-tool-context7/context7-cli.sh search "react"
~/.claude/skills/sf-tool-context7/context7-cli.sh docs reactjs/react.dev "useEffect"
~/.claude/skills/sf-tool-context7/context7-cli.sh docs prisma/prisma
```

Les identifiants de bibliothèques suivent la forme `owner/repo`, sans barre oblique initiale. En cas de doute, l'agent utilise d'abord `search`, puis `docs` avec l'identifiant résolu et une question
ciblée.

**Quand ne pas l'utiliser** : pour la syntaxe JavaScript ou TypeScript générale, le code interne du projet ou des API suffisamment stables pour ne pas nécessiter de nouvelle vérification, comme
`Array.prototype.map`.

## `sf-tool-atlassian`

Accès en lecture et en écriture à Jira et Confluence via leurs API REST. La skill se déclenche sur les URL `atlassian.net` et les mentions de Jira, Confluence, ticket, sprint, board, epic ou wiki.

**Commandes Jira** :

```bash
atlassian-cli.sh jira projects
atlassian-cli.sh jira issue SW-123
atlassian-cli.sh jira search "project = SW AND status = 'In Progress'"
atlassian-cli.sh jira create SW Task "Summary" --desc "Details"
atlassian-cli.sh jira transition SW-123 31
atlassian-cli.sh jira comment SW-123 "Ready for review"
atlassian-cli.sh jira worklog SW-123 2h
```

**Commandes Confluence** :

```bash
atlassian-cli.sh confluence spaces
atlassian-cli.sh confluence pages <SPACE_ID>
atlassian-cli.sh confluence page <PAGE_ID>
atlassian-cli.sh confluence search "text ~ 'keyword'"
atlassian-cli.sh confluence create <SPACE_ID> "Title" "<p>Body</p>"
```

**Identifiants nécessaires** :

```env
ATLASSIAN_EMAIL="you@example.com"
ATLASSIAN_API_TOKEN="ATATT..."
ATLASSIAN_DOMAIN="yourcompany.atlassian.net"
```

Créez le jeton API sur https://id.atlassian.com/manage-profile/security/api-tokens.

**Point fort** : les équipes qui alternent plusieurs Jira clients peuvent changer d'identité avec `sf tools use atlassian <client>`, sans nouvelle connexion dans le navigateur.

Cette skill donne accès aux contenus Jira et Confluence. Cela ne signifie pas que Jira fournit aujourd'hui le même workflow V1 complet que GitHub Projects : l'adaptateur de suivi Jira reste
expérimental.

## `sf-tool-notion`

Accès aux pages, bases de données et commentaires d'un espace Notion. La skill se déclenche sur les URL `notion.so` et les mentions de Notion, workspace, page ou database.

Trois parcours courants :

- **lire une page** à partir d'une URL Notion ;
- **interroger une base** par propriété, filtre et lignes ;
- **créer une page**, par exemple pour préparer des notes de release depuis les commits d'un ticket.

**Identifiant nécessaire** :

```env
NOTION_TOKEN="secret_..."
```

Créez une intégration sur https://www.notion.so/my-integrations, puis partagez avec elle les pages ou bases ciblées.

**Attention** : les autorisations Notion sont explicites. Une intégration ne peut lire ou écrire que les pages qui lui ont été partagées. Une erreur « object not found » indique souvent un partage
manquant.

Notion est aussi le **backend SRS complet de la V1** : le même jeton alimente le [module SRS](/fr/modules/srs), qui stocke les hiérarchies Epic et FR. Les autres backends SRS ne doivent pas être
présentés comme livrés tant qu'ils ne le sont pas. Consultez le [cycle de vie SRS](/fr/srs/lifecycle) et le [parcours guidé](/fr/srs/walkthrough).

Le backend SRS Notion n'est pas un adaptateur complet de tableau de workflow : ces deux responsabilités restent distinctes.

## `sf-tool-figma`

Accès en lecture seule aux fichiers, frames et métadonnées Figma. La skill se déclenche sur les URL `figma.com/file/...`.

Usages courants :

- récupérer les dimensions, couleurs et textes d'une frame pour une implémentation React fidèle ;
- traduire l'auto-layout d'un composant en classes Tailwind ;
- extraire des design tokens pour une migration de design system.

**Identifiant nécessaire** :

```env
FIGMA_TOKEN="figd_..."
```

Créez le jeton dans Figma → Settings → Personal access tokens.

**Limite** : la skill est en lecture seule et ne modifie pas les fichiers Figma.

## Skills d'outils du workflow

Une skill de workflow est installée par projet, selon la configuration choisie :

| Outil de tableau | Skill                                | Authentification                   | Disponibilité                                   |
| ---------------- | ------------------------------------ | ---------------------------------- | ----------------------------------------------- |
| GitHub Projects  | `sf-tool-github-projects`            | `gh auth login` et droits Projects | Workflow V1 complet                             |
| Jira             | `sf-tool-jira`                       | Jeton API Atlassian                | Expérimental                                    |
| Linear           | `sf-tool-linear`                     | Clé API Linear                     | Expérimental                                    |
| Notion           | aucune variante workflow V1 complète | Jeton d'intégration Notion         | Backend SRS V1 complet, pas tracker de workflow |

::: info Ce qui est livré aujourd'hui

`sf-tool-github-projects` est la référence complète du workflow V1. Les intégrations de contenu comme `sf-tool-atlassian` ou `sf-tool-notion` peuvent lire et écrire dans leurs services sans constituer
pour autant un adaptateur complet du workflow. Jira et Linear restent expérimentaux. Notion porte intégralement le SRS V1, pas le tableau de statuts.

:::

La skill du workflow constitue la plomberie utilisée par `sf-workflow` pour déplacer les tickets entre statuts, créer des sous-tickets, publier des plans de test et ouvrir les PR. Vous n'avez
généralement pas besoin de l'appeler directement : `sf-workflow` s'en charge.

Le CLI de `sf-tool-github-projects` reste utile à lire : il relie les sous-tickets natifs, signale chaque enfant dont le statut Projects n'est pas `Done` et fournit les données des garde-fous de
complétion et de l'agrégation des Epics.

Consultez l'[intégration GitHub](/fr/workflow/github-integration) pour comprendre les échanges avec Projects V2.

## Mettre à niveau les skills d'outils

Les skills d'outils participent à la fusion à trois voies de `sf update`, décrite dans le guide de [mise à jour des projets](/fr/guide/updating-projects). Si une skill amont évolue sans
personnalisation locale de son script, `sf update` applique automatiquement la nouvelle version. En présence d'une personnalisation — par exemple une commande `jira-epic` propre à l'entreprise — la
mise à jour arrive dans un fichier latéral `.saasfoundry.new` à examiner et fusionner manuellement.

**Ce que `sf update` ne modifie jamais** :

- vos identifiants dans `~/.claude/credentials/` ;
- le compte actif enregistré sous `.saasfoundry.json → skillsAccounts`.

Une mise à niveau ne peut donc pas effacer les identifiants. Au pire, elle produit un conflit à réconcilier sur un script CLI.

## Étapes suivantes

- [Créer des skills](/fr/skills/creating-skills) — construire une intégration personnalisée
- [Référence de `sf tools`](/fr/cli/sf-tools) — gérer les comptes
- [Référence de `sf skill`](/fr/cli/sf-skill) — gérer le cycle de vie des skills
