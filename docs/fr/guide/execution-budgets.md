# Budgets d’exécution dérivés de la session

SaaSFoundry peut déléguer automatiquement du travail à un modèle moins coûteux sans demander à l’utilisateur de configurer une limite de dépense arbitraire. L’autorité monétaire provient de la session
active visible par l’utilisateur : le coût p95 exact de son fournisseur, de son runtime, de son modèle, de son effort normalisé et de sa charge de travail attendue devient la référence `B` pour un
plan d’exécution proposé.

L’hôte fournit les preuves actuelles de charge de la session, les entrées faisant autorité de la proposition et des exigences, le catalogue de candidats actuel et la même politique de planification
que celle utilisée pour sélectionner le plan. La bibliothèque dérive l’enveloppe et recalcule la décision du planificateur pour chaque autorisation. Un appelant ne peut pas transformer un total mis en
cache ou une décision JSON auto-hachée en autorité. L’hôte doit également authentifier que les preuves de charge appartiennent à la session active.

## Autorité automatique

Pour un arbre d’exécution complet retenu, le planificateur enregistre :

- `E`, son coût p95 agrégé attendu exact ;
- `M`, son coût p95 maximal exact sur un chemin terminal ;
- `B`, la référence exacte dérivée de la session.

Le plan reçoit une autorité monétaire automatique uniquement lorsque `E <= B` et `M <= B`. La seconde borne empêche une rare nouvelle tentative ou un repli coûteux de se dissimuler derrière une faible
valeur attendue. L’égalité se situe dans l’enveloppe.

Toutes les comparaisons utilisent des rationnels de précision arbitraire réduits. L’arrondi d’affichage ne décide jamais de l’autorité. Par exemple, `B = 1.001` et `E = M = 1.009` peuvent tous deux
s’afficher comme `1.01`, mais le plan requiert toujours une approbation car son coût exact est supérieur.

## Approbation au-dessus de la référence

Un plan hors enveloppe produit un défi immuable au lieu de s’exécuter. Le défi contient :

```text
expected increment = max(0, E - B)
path increment     = max(0, M - B)
```

Il lie aussi la session et la révision d’autorité, les empreintes du plan et de la proposition, les exigences, le catalogue, la politique, la charge, la devise, la date du devis, l’expiration, un code
de motif stable, des codes de bénéfice et des références de preuve sûres. L’hôte doit montrer à l’utilisateur la référence de session, `E`, `M`, les deux incréments, le motif, le bénéfice attendu,
l’expiration et une courte empreinte du plan.

L’hôte authentifie la décision de l’utilisateur et émet une autorisation pour ces incréments exacts. Elle ne peut pas approuver une autre session, un autre plan, une autre révision de preuve, devise,
valeur ou fenêtre de validité. Son identifiant d’événement doit être unique. Le callback obligatoire de l’hôte l’authentifie et la consomme atomiquement ; retourner `false` rejette l’autorisation. La
bibliothèque d’exécution ne fournit pas le registre transactionnel durable, le portefeuille ou le système de facturation situé derrière ce callback.

## Approbation non monétaire distincte

L’autorité monétaire ne remplace pas l’approbation des outils, de la confidentialité ou des effets de bord. Un plan peu coûteux peut rester dans l’enveloppe de session tout en exposant
`nonMonetaryApprovalRequired: true`. Dans ce cas, `dispatchAuthorized` reste faux jusqu’à ce que l’hôte satisfasse la barrière indépendante et crée son autorisation finale d’exécution.

## Fraîcheur et comportement en cas d’échec

La charge de session, la disponibilité des candidats, les prix, les estimations du plan et les preuves du catalogue doivent être actuels lors de la planification et de l’évaluation. Les dimensions ou
prix manquants, devises mixtes, candidats inconnus, empreintes incohérentes, preuves expirées et valeurs sérialisées altérées échouent en mode fermé. Une grille de prix nuls explicitement complète
reste valide, y compris pour un runtime local.

Si les preuves changent avant l’exécution, l’hôte doit reconstruire le catalogue, replanifier et demander à nouveau l’autorité. La [replanification sûre](/fr/guide/execution-replanning) étend cette
politique à une lignée d’exécution bornée : les réservations p95 exécutées deviennent des coûts engagés et chaque plan de récupération reçoit une autorité nouvelle. Un calibrage futur peut améliorer
les preuves de charge et de prix, mais ne réécrit pas une décision d’autorité terminée.

Les [explications de décision](/fr/guide/execution-explanations) exposent le motif d’autorité, la référence et les incréments exacts, ainsi que toute barrière d’approbation indépendante. Le
[calibrage authentifié des résultats](/fr/guide/execution-calibration) peut affiner les estimations futures, mais un coût réglé ne rembourse jamais une réservation et n’élargit pas l’autorité de la
lignée actuelle.

L’enveloppe s’applique à une décision de plan. Ce n’est pas un portefeuille de session réutilisable. Une replanification ne peut comparer les réservations cumulées que dans la lignée d’exécution
actuelle, et les estimations p95 ne garantissent pas la facture finale du fournisseur.

## Flux de l’API publique

```ts
const catalogue = await executionCandidateCatalogue.snapshot()
const requirements = classifyTaskIntent(intent, constraints)
const plan = selectMinimumCostExecutionPlan(proposals, requirements, catalogue, policy)

const authority = authorizeExecutionPlan(
  plan,
  sessionWorkload,
  catalogue,
  policy,
  {
    evaluatedAt: new Date().toISOString(),
    justification
  },
  {
    requirements,
    proposals,
    verifySessionEvidence,
    consumeApprovalGrant
  }
)
```

N’exécutez que lorsque `status === 'authorized'` et `dispatchAuthorized === true`. Présentez `approval-required` à l’utilisateur, puis rappelez la fonction d’autorité avec l’autorisation authentifiée
par l’hôte. Traitez `rejected` comme un échec de planification ou de preuve à résoudre, et non comme une demande que l’hôte peut contourner.

Le [routage adaptatif local/cloud](/fr/guide/local-cloud-routing) réutilise exactement cette autorité monétaire et ajoute une autorisation de frontière indépendante, authentifiée par l’hôte, pour un
repli local vers le cloud explicitement déclaré. Son autorité composée utilise `validateExecutionPlanBudget` pour authentifier un incrément sans le consommer. La transaction finale de routage consomme
ensemble les autorisations budgétaire et de frontière ; un manifeste ou une autorisation de frontière rejeté ne peut donc pas brûler l’approbation monétaire. Aucune approbation n’élargit une exigence
stricte d’exécution locale uniquement.
