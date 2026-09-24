# Capacité SRS du harness

La SRS (Software Requirements Specification) fait partie du **harness de développement**. Elle maintient la hiérarchie Epic → FR → DS → TC dans un backend documentaire et pilote la création des
tickets. Elle ajoute un outil de collaboration au projet, pas du code d'exécution à l'application générée.

## Vue d'ensemble

- ✅ **Contrat indépendant du backend** — toutes les opérations passent par un `SrsAdapter` choisi depuis `tools.srs.backend`.
- ✅ **Notion complet en v1** — `NotionSrsAdapter`, modèles Epic/FR, ingestion de notes, rédaction depuis le code, création des Stories et hook conversationnel.
- ✅ **Intégration au workflow** — les labels `srs:drafting`, `srs:update` et `srs:new` activent `ai-draft → human-review → spawning`.
- ✅ **Passage spec → tickets** — chaque page FR approuvée peut produire une sous-issue GitHub reliée à sa source canonique.
- ✅ **Évaluation continue** — l'agent propose l'ajout d'un UR, FR, DS ou TC détecté en conversation et attend l'approbation.

Notion est un **backend SRS v1 complet**, mais pas un adaptateur complet de suivi des tickets. GitHub Projects reste l'intégration de workflow v1 complète. Confluence et Markdown local restent sur la
feuille de route SRS.

## Ce qui est installé

1. La compétence générique `sf-srs` : modèles, orchestrateur `srs-cli.sh` et dispatch `SrsAdapter`.
2. La compétence du backend, aujourd'hui `sf-tool-notion`, avec `NotionSrsAdapter`.
3. La configuration `tools.srs.*` dans `.saasfoundry.json`, y compris l'éventuel `pendingIngestion` à usage unique.

```jsonc
{
  "tools": {
    "srs": {
      "enabled": true,
      "backend": "notion",
      "rootPage": {
        "id": "...",
        "url": "https://www.notion.so/...",
        "name": "My project — SRS root"
      },
      "pendingIngestion": {
        "sourceBackend": "notion",
        "sourceParent": { "id": "...", "url": "...", "name": "Existing notes" },
        "createdAt": "2026-04-21T10:00:00.000Z"
      }
    }
  }
}
```

`pendingIngestion` disparaît après la première écriture réussie des `DraftCandidate[]`.

## Installation

### À la création

```bash
sf new --non-interactive \
  --project-name my-saas \
  --structure monorepo \
  --srs-enable \
  --srs-backend notion \
  --srs-parent-page-input "https://www.notion.so/..." \
  --srs-ingest-enable \
  --srs-ingest-parent-input "https://www.notion.so/legacy-notes-..."
```

### Dans un projet existant

```bash
sf update --add-modules srs \
  --srs-backend notion \
  --srs-parent-page-input "https://www.notion.so/..." \
  --notion-api-token "secret_..."
```

L'installateur dépose les compétences, initialise la racine via `adapter.init()`, écrit le manifeste et enregistre l'ingestion demandée. Le token Notion doit avoir accès aux pages source et cible.

## CLI et agent, mêmes garde-fous

| Objectif                            | CLI                                         | Demande à l'agent                                               |
| ----------------------------------- | ------------------------------------------- | --------------------------------------------------------------- |
| Vérifier le backend                 | `sf srs validate`                           | « Vérifie le backend SRS sans le modifier. »                    |
| Proposer depuis le code             | `sf srs draft --from codebase --path .`     | « Propose les exigences manquantes sans les appliquer. »        |
| Prévisualiser les tickets d'un Epic | `sf srs spawn --epic <url-or-id> --dry-run` | « Prévisualise les tickets ; ne crée rien. »                    |
| Appliquer un ajout approuvé         | `sf srs apply-update --patch <path>`        | « Applique ce patch additif approuvé et rapporte le résultat. » |

Une formulation naturelle ne supprime jamais les confirmations. Proposition, prévisualisation et application restent des actions distinctes.

## Les quatre flux principaux

| Flux                     | Entrée                                                           |
| ------------------------ | ---------------------------------------------------------------- |
| Rédiger depuis des notes | `browse` puis `draft --from notion-pages`                        |
| Rédiger depuis le code   | `draft --from codebase [--path <repo>]`                          |
| Créer les tickets        | réconciliation puis `spawn --ticket <parent> --epic <url-or-id>` |
| Faire évoluer la spec    | `apply-update`, additif uniquement en v1                         |

### Référence `srs-cli.sh`

```bash
srs-cli.sh validate
srs-cli.sh browse --parent <id>
srs-cli.sh draft --from notion-pages --ids id1,id2,...
srs-cli.sh draft --from codebase [--path <repo>]
srs-cli.sh write --spec /tmp/candidates.json
srs-cli.sh spawn --ticket 57 --epic <epic-page-url>
srs-cli.sh apply-update < patch.json
srs-cli.sh eval
```

Codes communs : `0` succès, `2` entrée invalide, `3` backend absent, `4` backend inconnu, `5` exécution, `6` écriture partielle, `7` suppression de `pendingIngestion` échouée.

## Pont obligatoire entre spec et ticket

Quand `tools.srs.backend` est défini, une Story sous un Epic SRS doit venir de sa page FR canonique. `create-subtask` refuse l'appel direct, sauf `--bypass-srs <raison>` pour un véritable ticket méta
ou un bootstrap antérieur à l'arborescence.

Un besoin produit suit donc toujours : **rédiger la FR → approuver → réconcilier → spawn**.

## Configuration

### `.saasfoundry.json → tools.srs.*`

| Clé                      | Rôle                                                          |
| ------------------------ | ------------------------------------------------------------- |
| `enabled`                | Active le hook conversationnel et la protection spec → ticket |
| `backend`                | `notion` en v1                                                |
| `rootPage.{id,url,name}` | Racine où les nouveaux Epics sont créés                       |
| `pendingIngestion`       | Signal temporaire d'ingestion au prochain démarrage           |

Ne modifiez pas `pendingIngestion` à la main : le CLI en est propriétaire.

### Environnement du backend Notion

```env
NOTION_API_TOKEN="secret_..."
NOTION_API_VERSION="2025-09-03"
```

Le token se crée dans les intégrations Notion. Partagez explicitement l'intégration avec la page parente, ainsi qu'avec la source lorsque l'ingestion est activée.

## Feuille de route

- backends Confluence et Markdown local ;
- migration d'une SRS entre backends ;
- score de fraîcheur face au code ;
- modification et suppression, au-delà du contrat ADD-only v1.

## Dépannage

### Backend absent — code 3

`tools.srs` manque dans le manifeste. Réactivez le module avec `sf update --add-modules srs` ou restaurez la configuration versionnée.

### Backend inconnu — code 4

La valeur n'est pas enregistrée. Le backend disponible aujourd'hui est `notion`.

### Refus de `create-subtask`

Rédigez et approuvez la FR, puis utilisez le spawner. Un bypass doit rester réservé au travail méta et expliquer sa raison.

### `pendingIngestion` reste présent

Le code 7 signifie que les pages ont été créées mais que le manifeste n'a pas pu être mis à jour. Vérifiez d'abord les pages et les permissions du fichier, puis reprenez l'opération de façon
contrôlée.

### L'agent ne propose jamais de mise à jour SRS en conversation

Vérifiez que `tools.srs.enabled` vaut `true` dans le manifeste. Le hook reste consultatif et applique les heuristiques du fichier `sf-srs/SKILL.md` ; il est volontairement silencieux lorsque le module
est désactivé.

## Mise à jour du projet

Le merge à trois voies de `sf update` protège les compétences modifiées localement. Gardez les personnalisations produit dans la documentation du projet pour recevoir plus facilement les améliorations
du harness.

L'adaptateur livré se trouve sous `src/tools/<backend>/srs.adapter.ts` dans le projet généré. `sf update` le fait évoluer tant que le fichier n'a pas été personnalisé localement.

## Étapes suivantes

- [Cycle de vie SRS](/fr/srs/lifecycle)
- [Tutoriel complet](/fr/srs/walkthrough)
- [Référence des scanners](/fr/srs/scanner-findings)
- [Mise à jour des projets](/fr/guide/updating-projects#activer-le-srs-sur-un-projet-existant)

## Commandes associées

- [`sf new --srs-enable`](/fr/cli/sf-new)
- [`sf update --add-modules srs`](/fr/cli/sf-update)
