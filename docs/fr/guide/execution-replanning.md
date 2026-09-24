# Replanification sûre de l’exécution

SaaSFoundry crée un nouveau plan lorsqu’un échec observé ou une contrainte modifiée invalide le plan actuel. Il ne corrige pas après coup une décision du planificateur, ne réutilise pas
silencieusement une approbation et ne considère pas un appel échoué comme gratuit. Chaque récupération reste liée à une lignée d’exécution bornée afin que l’hôte puisse prouver ce qui a été tenté,
l’autorité restante et la raison pour laquelle un autre plan est éligible.

## Déclenchement d’une replanification

Une branche déjà encodée dans l’arbre d’exécution autorisé est une continuation normale. La replanification ne commence que lorsque l’hôte invalide cet arbre ou ses permis d’exécution restants à cause
de l’un de ces événements typés :

- échec d’exécution ou de validation ;
- indisponibilité d’un candidat ;
- preuves obsolètes concernant un candidat, une estimation, une session ou un prix ;
- changement de politique ;
- changement matériel du périmètre ;
- permis d’exécution expiré.

La proposition précédemment retenue est fournie séparément des nouvelles propositions de récupération. L’hôte peut ainsi vérifier le nœud et le résultat observés même lorsque le candidat en échec ou
indisponible est volontairement absent du nouveau catalogue. La récupération relance toujours la qualification normale et la sélection déterministe au coût minimal avec les preuves actuelles.

Un résultat fournisseur ou outil ambigu utilise `outcome-unknown`. SaaSFoundry enregistre une entrée finale bloquée dans la lignée et refuse toute nouvelle tentative ou replanification automatique
jusqu’au rapprochement du résultat par l’hôte. Cela évite une dépense en double et la répétition d’effets de bord lorsqu’une requête a peut-être déjà réussi.

## Lignée d’exécution immuable

`createExecutionLineage` initialise une lignée bornée à partir d’un plan retenu. Chaque tentative initiale ou de récupération enregistre des identifiants sûrs et des empreintes pour le plan, les
exigences, le catalogue, la politique, la révision du périmètre, les références de preuve, les permis invalidés et l’éventuelle réservation p95. Les tentatives forment une chaîne de hachage en ajout
seul. Les plans et tentatives antérieurs ne sont jamais modifiés.

L’hôte authentifie la tête actuelle de la lignée et la révision du périmètre avant de planifier une récupération. Les échecs ordinaires doivent préserver les empreintes figées des exigences et de la
tâche. Une requête `scope-changed` exige une nouvelle révision du périmètre authentifiée par l’hôte et une autre empreinte de tâche, puis la tâche est à nouveau classée. Les contraintes enregistrées
pour les replanifications futures doivent faire partie de l’ensemble d’exigences faisant autorité fourni par l’hôte.

Les lignées ont des limites explicites de tentatives et de replanifications. Une lignée terminée, annulée ou bloquée ne peut pas être rouverte ; une tâche sensiblement différente après la fin démarre
une nouvelle lignée.

Chaque replanification acceptée enregistre tous les identifiants de permis non exécutés invalidés par la nouvelle révision. L’hôte reste responsable de la vérification atomique de cette liste, de la
persistance de la lignée avec une sémantique de comparaison-échange et de l’émission d’un nouveau permis d’exécution de courte durée.

## Autorité automatique restante

[L’autorité dérivée de la session](/fr/guide/execution-budgets) définit toujours la référence `B`. La replanification ajoute une comptabilité cumulée uniquement dans une même lignée. Soit `S` la somme
des réservations p95 exactes de toutes les tentatives ayant atteint l’exécution, et `Eᵣ` et `Mᵣ` les coûts agrégé attendu et maximal par chemin du nouvel arbre de récupération :

```text
remaining automatic authority = max(0, B - S)
recovery expected total        = S + Eᵣ
recovery maximum total         = S + Mᵣ
expected increment             = max(0, S + Eᵣ - B)
path increment                 = max(0, S + Mᵣ - B)
```

La réservation constitue une preuve permanente d’autorité pour la lignée. Une facture ou un calibrage ultérieur ne la libère pas. Une fois un échec observé, son coût est engagé et la racine de
récupération est atteinte avec une probabilité de un ; SaaSFoundry ne soustrait jamais l’allocation pondérée par la probabilité de l’ancien arbre.

`authorizeExecutionRecovery` recalcule le plan de récupération à partir des propositions et exigences détenues par l’hôte, vérifie la session active et l’historique de lignée, puis applique les deux
bornes cumulées. La récupération n’est automatique que si les deux totaux restent dans `B`. Sinon, elle crée un nouveau défi lié à l’identifiant d’exécution, la révision de lignée, la tête de
l’historique, le montant dépensé, le nouveau plan, les empreintes des preuves actuelles, la révision d’autorité et les incréments exacts. Une autorisation du plan initial ou d’une replanification
antérieure n’est pas transférable.

L’autorité monétaire reste distincte des approbations de confidentialité, d’outils et d’effets de bord. `dispatchAuthorized` ne devient vrai qu’après satisfaction de chaque barrière indépendante.

## Flux de l’API publique

```ts
const lineage = createExecutionLineage(initialPlan, scopeRevision, evidenceRefs, {
  runId,
  maxAttempts: 8,
  maxReplans: 4,
  taskFingerprint: requirements.taskFingerprint
})

const request = createExecutionReplanRequest({
  schemaVersion: 1,
  parentPlanDecisionId: lineage.currentPlanDecisionId,
  parentAttemptId: lineage.currentAttemptId,
  trigger: 'candidate-unavailable',
  scopeRevision,
  nodeId: 'primary',
  outcomeCode: 'candidate-unavailable',
  invalidatedPermitIds,
  evidenceRefs
})

const recovery = replanExecution(lineage, request, priorPlan, requirements, freshProposals, freshCatalogue, freshPolicy, priorSelectedProposal, { verifyLineage, verifyScopeRevision })

const authority = authorizeExecutionRecovery(
  recovery.decision,
  sessionWorkload,
  freshCatalogue,
  freshPolicy,
  authenticatedRecoveryHistory,
  { evaluatedAt, justification, approval },
  { requirements, proposals: freshProposals, verifySessionEvidence, verifyRecoveryHistory, consumeApprovalGrant }
)
```

N’exécutez qu’une décision `authorized` avec `dispatchAuthorized === true`, en utilisant une réservation atomique de l’hôte et une clé d’idempotence. Conservez les prompts bruts, sorties de modèle,
erreurs fournisseur, identifiants secrets et arguments d’outils hors de ces enregistrements publics.

Les [explications de décision](/fr/guide/execution-explanations) combinent les faits immuables de replanification, d’autorité, de lignée et de résultats authentifiés. Le
[calibrage](/fr/guide/execution-calibration) peut employer des résultats éligibles pour améliorer un plan ultérieur, sans modifier cette lignée ni aucune de ses réservations.
