# Vos outils restent la source de vérité

SaaSFoundryAI ne demande pas à votre équipe de déplacer tickets, spécifications et designs dans un espace IA privé supplémentaire. Il enregistre les systèmes choisis dans `.saasfoundry.json`, installe
les skills `sf-*` correspondants et fait utiliser ces systèmes au coding agent par des CLI protégés.

```text
Votre demande
    │
    ▼
sf-workflow ── lit .saasfoundry.json ──► tracker sélectionné
    │                                         │
    ├─ valide complexité et transitions      ├─ ticket / statut / PR natifs
    └─ délègue les opérations fournisseur     └─ historique durable de l'équipe
```

Le manifeste dit **quelle intégration fait autorité**. Le skill décrit **comment l'utiliser**. Le fournisseur reste la source durable que les humains peuvent inspecter sans reconstruire une
conversation IA.

## Trois surfaces d'intégration indépendantes

| Surface              | Source de vérité pour                            | Recommandation v1                         |
| -------------------- | ------------------------------------------------ | ----------------------------------------- |
| Tracker de livraison | Tickets, hiérarchie, statuts, revue et livraison | GitHub Projects                           |
| SRS / documentation  | Exigences, décisions et liens spec-vers-ticket   | Notion                                    |
| Contexte de design   | Maquettes, composants et échanges design         | Figma ou Miro si l'hôte peut les utiliser |

Ces choix sont volontairement indépendants. Vous pouvez exécuter le workflow dans GitHub Projects, conserver le SRS dans Notion et lire un design Figma dans la même tâche.

## Matrice de support honnête

### Workflow de livraison

| Tracker             | État dans la v1          | Ce que cela signifie                                                                                              |
| ------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| **GitHub Projects** | **Entièrement supporté** | Sous-tickets natifs, statuts, labels, types, état des PR, synchronisation de revue, milestones et rollups         |
| Jira                | Adaptateur expérimental  | Création et transitions existent ; la parité complète sur hiérarchie, guards, PR et milestones n'est pas garantie |
| Linear              | Adaptateur expérimental  | Les opérations issues/sous-issues existent ; tous les guards du contrat v1 ne sont pas encore implémentés         |
| Notion              | Pas un tracker v1        | Le CLI Notion livré gère pages et bases pour le SRS ; il n'équivaut pas à l'adaptateur GitHub Projects            |

::: warning Choisissez GitHub Projects pour le workflow v1 complet

Le moteur de configuration peut détecter les credentials Jira, Linear et Notion et contient des modèles d'adaptateurs préliminaires. Cela ne constitue pas une parité de bout en bout. La v1 est validée
avec GitHub Projects comme système de livraison de référence.

:::

### SRS et documentation produit

| Backend        | État dans la v1          | Capacité                                                                                       |
| -------------- | ------------------------ | ---------------------------------------------------------------------------------------------- |
| **Notion**     | **Entièrement supporté** | Arborescence, ingestion, brouillon, mises à jour et création réconciliée de Stories            |
| Confluence     | Feuille de route         | Credentials et outils Atlassian génériques existent ; l'adaptateur SRS neutre n'est pas livré  |
| Markdown local | Feuille de route         | Cible sans service distant déclarée, pas encore sélectionnable comme backend SRS de production |

Le contrat de la couche SRS est indépendant du backend. Dans la v1, l'adaptateur implémenté est Notion. Cette neutralité facilite les futurs adaptateurs ; elle ne signifie pas qu'ils existent déjà.

### Design et contexte technique

Figma, Miro et Context7 sont des outils de contexte optionnels, pas des autorités de workflow :

- **Figma** — lecture des fichiers, nœuds, exports, composants et commentaires via le skill installé, si les credentials et l'hôte le permettent.
- **Miro** — lecture du contexte des boards via le skill optionnel lorsque l'environnement fournit l'accès nécessaire.
- **Context7** — récupération de documentation publique actuelle sans modifier le workflow du projet.

Sélectionner un outil installe ou recommande ses instructions de projet. Cela n'installe pas l'application externe, n'accorde pas les permissions fournisseur et ne prouve pas que l'hôte du coding
agent a chargé un connecteur.

## Le contrat de configuration

```jsonc
{
  "workflow": {
    "tool": "github-projects",
    "projectUrl": "https://github.com/orgs/acme/projects/4",
    "workingBranch": "develop",
    "prTargetBranch": "develop"
  },
  "tools": {
    "srs": {
      "enabled": true,
      "backend": "notion",
      "rootPage": {
        "id": "...",
        "url": "https://www.notion.so/...",
        "name": "SRS produit"
      }
    }
  },
  "skillsAccounts": {
    "notion": "work",
    "figma": "work"
  }
}
```

`sf-workflow` lit `workflow.tool` avant chaque opération de board et délègue au CLI `sf-tool-*` correspondant. `sf-srs` résout `tools.srs.backend` avant chaque opération de spécification. Le coding
agent ne choisit pas un autre fournisseur simplement parce qu'un connecteur différent est disponible.

## Les credentials restent hors du dépôt

Les comptes gérés par `sf tools` résident sous :

```text
~/.claude/credentials/<outil>/<compte>.env
```

Le dépôt ne stocke que le nom du compte dans `skillsAccounts`. Vous pouvez ainsi séparer comptes personnels et professionnels sans committer de tokens.

```bash
sf tools add notion work
sf tools use notion work
sf tools current
```

La commande actuelle `sf tools add` gère les comptes Atlassian, Notion et Figma. GitHub Projects utilise le CLI `gh` authentifié. Les autres intégrations peuvent dépendre de leur propre skill ou du
connecteur de l'hôte tant que la gestion des credentials n'est pas unifiée.

::: danger Ne copiez pas les credentials entre agents

Installer des instructions portables ne transfère ni authentification, ni permissions, ni hooks, ni réglages de modèle. Vérifiez l'accès dans l'hôte réel et ne collez jamais de secret dans un ticket,
un plan ou un rapport.

:::

## Un test de connexion est une preuve, pas une autorité

Pendant la configuration, SaaSFoundryAI peut exécuter une vérification bornée :

- GitHub : `gh auth status`, ou présence locale du token avec `--no-network` ;
- Notion, Atlassian, Linear, Figma et Miro : appel API spécifique si les credentials existent ;
- markdown local : aucun service distant à tester.

Un avertissement conserve le choix mais indique que les credentials devront être complétés. Une vérification réussie prouve que le credential courant atteint le fournisseur ; elle n'accorde pas
l'accès à tous les projets, pages ou fichiers.

Utilisez la commande de statut pour un diagnostic uniquement local :

```bash
sf status --claude-friendly --no-network
```

## Ce que fait réellement l'agent

Avec GitHub Projects, une tâche de livraison possède une chaîne de responsabilité visible :

1. lire l'issue native et son statut de board ;
2. classer la complexité et persister le label ;
3. publier un plan lorsque la complexité exige une validation ;
4. mettre à jour le statut natif via le CLI de workflow protégé ;
5. créer de vrais sous-tickets plutôt que des checklists cachées ;
6. pousser la branche et ouvrir la pull request reliée au ticket ;
7. synchroniser la revue et vérifier le merge avant `Done`.

L'agent travaille comme un contributeur dans vos outils existants. SaaSFoundryAI ajoute un contrat d'exploitation reproductible autour de ces actions.

## Continuer

- [Introduction au workflow](/fr/workflow/introduction)
- [Intégration GitHub](/fr/workflow/github-integration)
- [Module SRS](/fr/modules/srs)
- [Référence `sf tools`](/fr/cli/sf-tools)
