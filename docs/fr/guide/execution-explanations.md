# Explication des décisions d’exécution

SaaSFoundry fournit une explication déterministe pour chaque décision de plan indépendante des fournisseurs. Cette explication est une projection sûre des enregistrements immuables du planificateur,
du budget, de la récupération, de la lignée et des résultats authentifiés. Elle ne relance jamais la qualification, ne change pas le plan retenu et n’accorde aucune autorisation.

## Contenu d’une explication

`explainExecutionDecision` présente :

- la proposition retenue et le candidat racine ;
- les coûts p95 exacts, agrégé attendu et maximal par chemin ;
- toutes les autres propositions qualifiées, avec le coût ou la règle de départage qui les place derrière le choix retenu ;
- les propositions exclues, regroupées par codes stables de contrainte et de validation ;
- les empreintes des exigences, du catalogue et de la politique utilisées par le planificateur ;
- le résultat de l’autorisation monétaire, la référence de session, les incréments à approuver et la barrière non monétaire indépendante ;
- les dépenses de récupération et l’autorité restante lorsque la décision appartient à une replanification ;
- l’état actuel de la lignée d’exécution, le dernier déclencheur ou résultat et les permis invalidés ;
- les résultats authentifiés normalisés : consommation, latence, résultat de validation, numéro de tentative et motif de repli.

Les tableaux et références sont canonisés avant le calcul de l’empreinte de l’explication. Des entrées validées équivalentes produisent donc le même identifiant d’explication, quel que soit l’ordre
des propositions, du catalogue, des résultats ou des références de preuve.

## Codes stables, présentation hors du contrat

Le contrat public contient des codes stables, des identifiants sûrs, des preuves numériques exactes, des horodatages, des empreintes et des références de preuve opaques. Un CLI ou une interface
transforme ces valeurs en texte localisé. Le cœur du contrat reste ainsi indépendant des fournisseurs et le moteur de rendu ne peut pas influencer la planification.

Le contrat rejette les enregistrements inconnus ou incohérents et n’accepte jamais les prompts bruts, les sorties générées, les arguments ou résultats d’outils, les charges utiles fournisseur, les
en-têtes de réponse, les identifiants secrets ni les messages d’erreur arbitraires. Les références opaques doivent être produites et authentifiées par l’hôte ; respecter la syntaxe d’un identifiant
sûr ne suffit pas à rendre des données appelantes fiables.

## Les explications historiques ne dérivent pas

Les explications consultent les décisions historiques plutôt qu’un catalogue en direct. Une mise à jour des prix, une panne fournisseur, un rapprochement des résultats ou un
[instantané de calibrage](/fr/guide/execution-calibration) ultérieur peut créer un nouveau plan et une nouvelle explication, sans réécrire celle d’une exécution antérieure. Les autorisations
budgétaires et réservations de lignée restent liées aux empreintes de leur décision d’origine.

```ts
const explanation = explainExecutionDecision(planDecision, {
  budgetDecision,
  lineage,
  outcomes: authenticatedOutcomes
})
```

Présentez aux utilisateurs les codes de motif et les faits retournés, et ne résolvez les preuves privées que dans une vue hôte autorisée.

`explainAdaptiveExecutionRoute` applique les mêmes règles de projection sûre au [routage local/cloud](/fr/guide/local-cloud-routing), notamment aux mesures opérationnelles, aux nœuds de repli
visibles, à la frontière de confidentialité et à l’état des approbations indépendantes.
