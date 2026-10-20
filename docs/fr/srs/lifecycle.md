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
.claude/skills/sf-workflow/workflow-cli.sh transition-drafting <ticket> ai-draft                 # affiche la procédure, ne modifie rien
.claude/skills/sf-workflow/workflow-cli.sh transition-drafting <ticket> ai-draft --spec <file>   # écrit la spécification rédigée
```

Aucune commande ne rédige une nouvelle feature à partir d'un ticket : l'agent écrit le `DraftCandidate[]`, le vérifie avec `srs-cli.sh validate --spec <file>`, puis la phase l'écrit. Il s'appuie sur
l'une des trois sources :

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

Avant toute mutation, l'agent inspecte le tableau, la version SRS approuvée, le code, les tests et la documentation. L'Epic de version `<feature> - <version>` porte les Stories : spawn le crée, ou
reprend celui qu'une exécution précédente a créé ; `--ticket <epic>` en désigne un existant. Le ticket de rédaction n'est jamais le parent : le corps de l'Epic indique `Drafted in #<ticket>`. Un plan
de réconciliation couvre chaque FR et la classe comme `delivered`, `partial`, `missing` ou `superseded`.

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
- relie chaque Story comme sous-issue native de l'Epic de version ;
- rend son corps depuis la page FR : description, UR et leurs énoncés, critères d'acceptation, références DS et contraintes ;
- place les tickets sur le tableau, en `Backlog`, pour leur workflow de code normal.

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
| `srs-cli.sh apply-update < patch.json`                           | Ajoute un UR, FR, DS ou TC approuvé, ou modifie une FR  |
| `srs-cli.sh eval [--review-packet <path>]`                       | Mesure la fraîcheur de la SRS face au code              |

`update-status` refuse les phases de test/revue du code pour un ticket `srs:*` : il faut utiliser `transition-drafting`.

## Évaluation continue en conversation

Lorsque `tools.srs.enabled = true`, l'agent détecte les formulations qui ressemblent à une nouvelle exigence, ou à un changement d'une FR existante :

| Signal                          | Proposition                      |
| ------------------------------- | -------------------------------- |
| Besoin ou résultat utilisateur  | **UR** sur l'Epic                |
| Fonctionnalité ou règle         | nouvelle page **FR**             |
| Décision d'implémentation       | **DS** sur la FR concernée       |
| Condition d'acceptation ou test | **TC** sur la FR concernée       |
| Décision rouverte               | la **FR** est modifiée sur place |

Il présente un diff et attend `accept`, `edit` ou `reject`. L'acceptation appelle `srs-cli.sh apply-update`, puis la tâche en cours continue.

### Modifier une FR existante

Une révision de FR n'est pas ajoutée comme élément de conception : elle est appliquée à la FR là où elle est listée, avec un correctif `update-fr` qui désigne l'identifiant de la FR et les champs qui
changent (`title`, `description`, `priority`, `complexity`, `endpoint`, `requestBody`, `securityRationale`, `acceptanceCriteria`, `validationRules`). La page de la FR (ses tableaux Summary et
Field/Value, et pour un nouveau titre sa section et le titre de la page), le tableau des FR de sa version et celui de sa fonctionnalité affichent les nouvelles valeurs, et une ligne est ajoutée à «
What changed in this version » de la version. Le contrat d'adaptateur a une mise à jour sur place (`SrsAdapter.updateSections`) pour cela, implémentée pour Notion ; un backend qui ne l'a pas est
refusé avec le code 5 et rien n'est écrit.

- **Prévisualiser d'abord** : `srs-cli.sh apply-update --dry-run < patch.json` affiche l'ancienne et la nouvelle valeur de chaque cellule et la ligne de changement, sans rien écrire. L'agent le montre
  avant de demander l'application.
- **Refusé avant toute écriture** : un identifiant de FR inconnu ou en double, une page de FR qui ne peut pas recevoir le changement, un correctif vide, un champ inconnu, et les références (`urRefs`,
  `dsRefs`, `tcRefs`), qui sont aussi listées dans les tableaux des UR, DS et TC ([#1056](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/1056)).
- **Rejouable** : une cellule déjà à sa valeur est laissée telle quelle et la ligne de changement n'est pas écrite deux fois. Une écriture qui s'arrête en cours de route sort avec le code 6 et affiche
  `applied`, `pending` et `before` ; appliquer de nouveau le même correctif la termine.
- **La Story garde son ancien texte** : une Story déjà générée depuis la FR n'est pas réécrite ([#1057](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/1057)) ; le `followUps` du résultat la
  nomme.

### Limites volontaires

- Un UR, DS, TC ou NFR ne peut qu'être **ajouté** : le modifier sur place est hors périmètre. Une révision de l'un d'eux se propose comme un élément ajouté qui documente le revirement.
- `add-ur`, `add-ds`, `add-tc` et `add-nfr` vont dans leur tableau sur la page de la fonctionnalité, avec la version de la page d'où ils sont ajoutés ; seulement si la page n'appartient pas au SRS ou
  si le tableau manque, ils tombent sous un titre « Added … » en fin de page, et le résultat le dit.
- `add-fr` crée une page enfant sous la version, puis ajoute sa ligne au tableau des FR et à la liste des changements de la version, et aux tableaux de la fonctionnalité.
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
