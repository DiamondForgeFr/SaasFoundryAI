# Outils de développement

SaaSFoundryAI sépare quatre responsabilités souvent confondues : l'application générée, son CLI déterministe, le harness de développement et les services externes que vous choisissez de connecter.

```text
agent de code ──lit──► instructions du projet + skills sf-*
                              │
                              ▼
                         CLI SaaSFoundry
                              │
                              ▼
                    espace SaaS généré
                              │
              ┌───────────────┼────────────────┐
              ▼               ▼                ▼
        GitHub Projects    SRS Notion     outils facultatifs
        suivi livraison    exigences      design/contexte
```

L'application générée n'impose aucun éditeur, terminal ou fournisseur d'IA.

## 1. Le CLI SaaSFoundry

Le CLI est la couche déterministe utilisée par les humains et les agents :

```bash
sf new --project-name my-product
sf status --agent-friendly --no-network
sf modules list
sf update
sf workflow show
```

Il gère le scaffolding, la configuration, les mises à jour des fichiers gérés et les diagnostics. Un agent doit proposer et exécuter des commandes CLI explicites, pas inventer un générateur parallèle
non documenté.

## 2. Hôtes d'agents de code

Le harness peut déclarer les identifiants de profils suivants :

- `claude-code`
- `codex`
- `gemini-cli`
- `kimi`
- `qwen-code`
- `generic`

Ces identifiants désignent des intégrations d'hôtes, pas des fournisseurs de modèles. Un profil écrit les points d'entrée d'instructions et références de skills adaptés ; il n'installe pas le runtime,
ne choisit pas de modèle, ne transfère pas d'identifiants et ne prouve pas la découverte native.

```bash
sf agents list --json
sf agents enable codex
sf agents replace claude-code codex --scope shared
sf agents doctor codex claude-code
```

Claude Code dispose actuellement du bootstrap natif en une phrase. Les autres hôtes commencent par le CLI et le profil déclaré, puis suivent le fichier `AGENTS.md` généré ou leur point d'entrée
propre.

## 3. Instructions du projet et skills

La source gérée historique reste sous `.claude/` ; les copies portables partagées des agents déclarés se trouvent sous `.agents/` :

```text
CLAUDE.md
AGENTS.md
.claude/skills/sf-*/
.agents/skills/sf-*/
```

Dans un projet SaaSFoundry, privilégiez les procédures `sf-*` aux skills globales génériques. Les versions du projet connaissent `.saasfoundry.json`, la politique de branches, la topologie et les
garde-fous du workflow.

## 4. Tableau de livraison

Le cœur du workflow délègue les opérations sur les tickets à un adaptateur de tableau.

| Tableau         | Niveau V1                                                                      |
| --------------- | ------------------------------------------------------------------------------ |
| GitHub Projects | Complet : tickets, enfants natifs, statuts, milestones, garde-fous PR et merge |
| Jira            | Adaptateur expérimental                                                        |
| Linear          | Adaptateur expérimental                                                        |
| Notion          | Pas un tracker de workflow complet en V1                                       |

L'authentification GitHub provient du CLI `gh` et, pour certaines opérations Projects V2, du jeton configuré. Les identifiants ne sont jamais enregistrés dans `.saasfoundry.json`.

### Team, Solo et Custom

Les presets décrivent le cycle de livraison, indépendamment de l'outil de tableau :

- **Team** utilise le parcours complet `Backlog → Ready → In progress → AI testing → Human testing → In review → Done`. **Human testing** signifie test de la fonctionnalité et validation fonctionnelle
  ; **In review** signifie revue de code.
- **Solo** supprime la colonne Human testing distincte. La personne qui développe effectue tout de même la validation fonctionnelle pendant la revue de la PR, avant le merge.
- **Custom** enregistre et synchronise des configurations avancées de statuts. Team et Solo restent les seuls parcours v1 possédant des documents générés complets et des garde-fous testés de bout en
  bout.

## 5. SRS et documentation produit

Notion est le backend SRS V1 complet. Il stocke la hiérarchie Epic/FR/DS/TC, prend en charge l'ingestion et réconcilie les exigences approuvées avec les tickets de livraison. Confluence et Markdown
local sont des cibles futures, pas des backends complets livrés aujourd'hui.

Ce rôle SRS est indépendant du tableau de livraison. Un projet peut utiliser GitHub Projects pour la livraison et Notion pour les exigences sans prétendre que Notion implémente le contrat de workflow
GitHub.

## 6. Outils de contexte facultatifs

Les skills facultatives `sf-tool-*` peuvent connecter l'agent à la documentation de bibliothèques, Atlassian, Notion ou Figma lorsque les identifiants et l'accès natif sont disponibles. Elles
enrichissent les décisions sans accorder silencieusement de droits en écriture.

```bash
sf tools list
sf tools add notion work
sf tools use notion work
sf status --agent-friendly --no-network
```

Une lecture de configuration réussie prouve uniquement que le projet déclare l'outil. Effectuez un contrôle de connexion explicite avant de dépendre du service distant.

## Une disposition pratique du terminal

N'importe quel terminal ou IDE convient. Voici une disposition locale utile :

```text
┌─────────────────────────┬─────────────────────────┐
│ agent de code / éditeur │ navigateur              │
├─────────────────────────┼─────────────────────────┤
│ logs de l'API           │ logs web / tests        │
└─────────────────────────┴─────────────────────────┘
```

Lancez le projet généré selon sa topologie :

```bash
# monorepo
npm run dev

# ou séparément dans un multirepo
npm run dev --prefix apps/api
npm run dev --prefix apps/web
```

Utilisez les ports indiqués par `sf status` ; ne supposez pas que les exemples correspondent à un manifest personnalisé.

## Ce qui peut être automatisé sans risque

- lire l'état et la documentation du projet ;
- proposer des commandes et une configuration ;
- générer le scaffold après des réponses explicites ;
- exécuter les builds et tests locaux ;
- préparer les plans, rapports de tests et pull requests ;
- utiliser les transitions protégées du tableau.

Le harness garde l'humain dans la boucle pour les actions destructives, les écritures externes, la validation fonctionnelle, l'approbation de la revue de code et les merges, conformément au workflow
configuré.

## Continuer

- [Installation](/fr/getting-started/installation)
- [Configuration avec le CLI ou un agent](/fr/getting-started/setup-paths)
- [Connecter vos outils](/fr/features/your-tools)
- [Coexistence des agents](/fr/guide/agent-coexistence)
- [Système de skills](/fr/guide/skills-system)
