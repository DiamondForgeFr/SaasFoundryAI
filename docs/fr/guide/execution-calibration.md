# Résultats d’exécution et calibrage

SaaSFoundry enregistre ce qui s’est passé après l’exécution séparément des estimations du planificateur. Les résultats authentifiés servent immédiatement à l’audit et à l’explication ; un instantané
de calibrage borné peut ensuite transformer une cohorte qualifiée de ces résultats en nouvelles preuves d’estimation pour les plans futurs.

## Enregistrements de résultats authentifiés

`recordExecutionOutcome` lie un résultat normalisé à l’exécution exacte, à la révision et la tête de lignée, à la tentative, au permis d’exécution, à la décision de plan, à la proposition, au nœud, au
candidat, au numéro de nouvelle tentative et à la cohorte de calibrage. L’enregistrement contient uniquement :

- les quantités facturables réelles normalisées ;
- une latence bornée ;
- un code de résultat placé sur liste blanche ;
- le résultat de validation et les codes des contrôles exécutés ;
- un éventuel motif de nouvelle tentative, de repli ou de replanification ;
- les dates canoniques d’occurrence et de réception ;
- le type de source et des références de preuve opaques.

L’hôte vérifie le règlement du fournisseur, le compteur du runtime ou l’enregistrement d’exécution, puis l’ajoute atomiquement. Rejouer le même événement avec le même contenu canonique retourne
l’enregistrement existant. Réutiliser la clé d’événement avec des consommations, liaisons ou résultats différents est rejeté, tout comme un second résultat terminal. Les hachages détectent une
altération accidentelle ou côté appelant ; l’authentification durable et le stockage en comparaison-échange restent sous la responsabilité de l’hôte.

Les enregistrements `outcome-unknown`, annulés, partiellement mesurés ou non mesurés restent utiles pour l’audit, mais sont censurés pour le calibrage. Ils ne peuvent pas signaler une réussite,
réduire une estimation p95, libérer une réservation de lignée ni autoriser une nouvelle tentative.

## Calibrage isolé et borné

`deriveExecutionCalibrationSnapshot` accepte des enregistrements authentifiés pour une cohorte exacte :

- candidat canonique et effort ;
- type de runtime ;
- classe de charge ;
- frontière de confidentialité ;
- frontière opaque de locataire ou de sécurité.

Cela empêche les preuves d’un locataire restreint d’entrer dans un estimateur partagé. La politique déclare aussi une date limite, une version d’estimateur, un nombre minimal et maximal
d’échantillons, un quantile au rang le plus proche, des plafonds de consommation par dimension, un plafond de latence, une date de génération, une expiration et une référence de preuve opaque. Les
plafonds limitent l’influence d’un échantillon anormal ou empoisonné. Les enregistrements postérieurs à la date limite ou issus d’une autre cohorte sont exclus de façon déterministe.

L’instantané immuable contient les identifiants canoniques des résultats sources et une empreinte d’historique, les estimations p95 calibrées de consommation et de latence, des taux exacts sous forme
rationnelle et sa fenêtre de validité. L’ordre des entrées ne modifie pas l’instantané.

## Preuves uniquement prospectives

`applyExecutionCalibrationToPlanEstimate` copie une proposition et remplace uniquement les preuves d’estimation de consommation et de latence futures du nœud choisi. Il ne modifie pas la proposition
source et ne change ni capacités, confidentialité, outils, prix, exigences, politique, charge de session, autorité, autorisations, réservations, lignée ou résultats historiques. Les taux de résultat
restent des preuves rationnelles explicites pour le générateur de propositions de l’hôte ; ils ne sont jamais silencieusement arrondis dans un arbre.

```ts
const outcome = recordExecutionOutcome(rawOutcome, expectedDispatchBinding, outcomeHost)
const snapshot = deriveExecutionCalibrationSnapshot(outcomes, cohort, calibrationPolicy, calibrationHost)
const futureProposal = applyExecutionCalibrationToPlanEstimate(previousProposal, 'primary', snapshot)
const futureDecision = selectMinimumCostExecutionPlan([futureProposal, ...alternatives], requirements, catalogue, policy)
```

La décision future doit réussir la qualification normale et recevoir une nouvelle [autorité budgétaire](/fr/guide/execution-budgets). Un instantané obsolète exclut la proposition via les contrôles
existants de fraîcheur des estimations. Un coût réglé ne sert qu’à l’audit et au calibrage ; il ne rembourse jamais la réservation p95 prudente utilisée par la
[replanification sûre](/fr/guide/execution-replanning).
