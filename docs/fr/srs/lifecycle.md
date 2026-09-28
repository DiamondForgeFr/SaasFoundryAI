# Cycle de vie de la SRS

Le module SRS possède un mini-cycle de rédaction à l'intérieur du workflow du projet. Les tickets portant un label `srs:*` suivent cette voie spécialisée ; les tickets de code continuent à suivre le
preset configuré, complet, Solo ou personnalisé.

## Les deux voies

| Label                                       | Voie           | Parcours                                                                                 |
| ------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------- |
| aucun label `srs:*`                         | Livraison code | Statuts de `workflow.statuses` : sept pour l'équipe, cinq pour Solo, ou le modèle choisi |
| `srs:drafting` \| `srs:update` \| `srs:new` | Rédaction SRS  | `Backlog → Ready → In progress → ai-draft → human-review → spawning → Done`              |

Les phases `ai-draft`, `human-review` et `spawning` sont suivies par `workflow-cli.sh` sans ajouter de colonnes au tableau GitHub Projects.

::: tip Quel label choisir ?

`srs:new` pour une nouvelle arborescence d'Epic, `srs:drafting` pour une rédaction issue de notes existantes et `srs:update` pour une évolution d'un Epic. La voie reste la même ; le label indique
l'intention.

:::

## Les phases SRS

### 1. Backlog

Le propriétaire décrit l'Epic, les exigences fonctionnelles ou la mise à jour, ajoute le label `srs:*` et définit la complexité. Aucun contenu SRS n'est encore écrit.

### 2. Ready

Le périmètre est compréhensible et validé. L'agent challenge les manques puis attend l'accord du propriétaire. Cette phase de la voie SRS reste explicite, même si le preset de livraison du code est
Solo.

### 3. In progress — cadrage

Le propriétaire et l'agent choisissent les pages sources, le mode d'ingestion et la structure d'Epic visée. Rien n'est écrit tant que les entrées ne sont pas assez précises.

### 4. ai-draft

```bash
.claude/skills/sf-workflow/workflow-cli.sh transition-drafting <ticket> ai-draft
```

Le rédacteur utilise l'une des trois sources :

- **notes existantes** : `srs-cli.sh browse`, puis `draft --from notion-pages --ids ...` produit du `RawContent` ; l'agent propose un `DraftCandidate[]` avant toute écriture ;
- **code existant** : `draft --from codebase` lance cinq scanners et produit des `ScannerFinding[]` pour endpoints, écrans, modèles Prisma, tests et documentation ;
- **green field** : l'agent compose directement `EpicSpec` et `FrSpec[]` à partir de la conversation.

Après approbation, la commande suivante écrit l'Epic et ses pages FR dans le backend configuré :

```bash
.claude/skills/sf-srs/scripts/srs-cli.sh write --spec /tmp/candidates.json
```

En v1, **Notion est le backend SRS complet**. Il faut distinguer cette capacité de la gestion du workflow : Notion n'est pas encore un tracker v1 complet. `pendingIngestion` est supprimé après une
écriture réussie.

### 5. human-review — revue de la spécification

```bash
.claude/skills/sf-workflow/workflow-cli.sh transition-drafting <ticket> human-review
```

Le propriétaire relit dans Notion :

- la page principale : vue d'ensemble, périmètre, personas et traçabilité ;
- chaque page `FR-001`, `FR-002`, etc. : UR, FR, DS et TC.

Les petites corrections sont faites directement dans la page. Une refonte complète peut revenir à `ai-draft`. La sortie exige une approbation explicite pour créer les tickets.

Cette phase ne doit pas être confondue avec `Human testing` du workflow de code : ici on relit une **spécification** ; dans le workflow d'équipe, `Human testing` est la **validation fonctionnelle
d'une fonctionnalité implémentée**.

### 6. spawning — réconciliation et création des Stories

Avant toute mutation, l'agent inspecte le parent, ses enfants, la version SRS approuvée, le code, les tests et la documentation. Un plan de réconciliation couvre chaque FR et la classe comme
`delivered`, `partial`, `missing` ou `superseded`.

```bash
.claude/skills/sf-workflow/workflow-cli.sh transition-drafting <ticket> spawning \
  --epic <feature-url-or-id> \
  --version <title-url-or-id> \
  --milestone v1.0.0 \
  --reconciliation-plan /tmp/reconcile.json \
  --dry-run
```

Après vérification, la même commande sans `--dry-run` :

- ignore les FR déjà livrées ou remplacées ;
- réutilise un ticket canonique unique ;
- crée uniquement le travail manquant ou partiel sans correspondance ;
- relie chaque Story comme sous-issue native du parent ;
- rend son corps depuis la page FR : résumé, critères issus des TC et chaîne UR → FR → DS → TC ;
- place les nouvelles Stories en `Backlog` pour leur workflow de code normal.

La reprise est prudente : une réponse interrompue peut être rejouée avec le même plan. Les identifiants contradictoires, les correspondances multiples et le reparentage implicite sont refusés.

### 7. Done

Le ticket de rédaction est terminé et garde son label `srs:*` comme provenance. Les Stories générées poursuivent leur propre cycle de livraison.

## Référence des commandes

| Commande                                                         | Effet                                                   |
| ---------------------------------------------------------------- | ------------------------------------------------------- |
| `workflow-cli.sh transition-drafting <ticket> <phase> [options]` | Pilote `ai-draft`, `human-review`, `spawning` et `done` |
| `srs-cli.sh validate`                                            | Vérifie le backend configuré                            |
| `srs-cli.sh browse --parent <id>`                                | Liste les enfants directs d'une page                    |
| `srs-cli.sh draft --from notion-pages --ids <ids>`               | Lit des pages en `RawContent`                           |
| `srs-cli.sh draft --from codebase [--path <repo>]`               | Produit les constats des scanners                       |
| `srs-cli.sh write --spec <path>`                                 | Écrit un `DraftCandidate[]` approuvé                    |
| `srs-cli.sh apply-update < patch.json`                           | Ajoute un UR, FR, DS ou TC approuvé                     |
| `srs-cli.sh eval [--review-packet <path>]`                       | Mesure la fraîcheur de la SRS face au code              |

`update-status` refuse les phases de test/revue du code pour un ticket `srs:*` : il faut utiliser `transition-drafting`.

## Évaluation continue en conversation

Lorsque `tools.srs.enabled = true`, l'agent détecte les formulations qui ressemblent à une nouvelle exigence :

| Signal                          | Proposition                |
| ------------------------------- | -------------------------- |
| Besoin ou résultat utilisateur  | **UR** sur l'Epic          |
| Fonctionnalité ou règle         | nouvelle page **FR**       |
| Décision d'implémentation       | **DS** sur la FR concernée |
| Condition d'acceptation ou test | **TC** sur la FR concernée |

Il présente un diff et attend `accept`, `edit` ou `reject`. L'acceptation appelle `srs-cli.sh apply-update`, puis la tâche en cours continue.

### Limites volontaires de la v1

- Le hook est **ADD-only** : il ajoute mais ne remplace ni ne supprime.
- Les UR, DS et TC sont ajoutés sous une section dédiée en fin de page.
- `add-fr` crée une page enfant, sans reconstruire automatiquement la table de traçabilité de l'Epic.
- Une seule proposition est émise par tour de conversation.

## Jonction avec la livraison de code

```text
Voie SRS                                 Voie de livraison des Stories

Backlog → Ready → In progress
                   → ai-draft
                   → human-review
                   → spawning ─────────▶ Backlog → workflow configuré → Done
                              └─────────▶ Backlog → workflow configuré → Done
                   → Done
```

La page FR reste la source canonique. Si elle évolue après le spawn, le corps du ticket n'est pas automatiquement régénéré : l'implémenteur relit la page liée au moment de prendre la Story.

## Étapes suivantes

- [Module SRS](/fr/modules/srs)
- [Tutoriel SRS](/fr/srs/walkthrough)
- [Référence des constats des scanners](/fr/srs/scanner-findings)
- [Centraliser les exigences produit](/fr/srs/centralization)
