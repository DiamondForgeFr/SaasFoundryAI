# Planification d’exécution au coût minimal

SaaSFoundry classe des arbres d’exécution complets plutôt que des appels de modèle isolés. Une proposition décrit explicitement la tentative principale, la validation, les nouvelles tentatives bornées
et les replis, avec leurs probabilités conditionnelles et leurs estimations de consommation p95. La planification reste ainsi indépendante des fournisseurs et un premier appel peu coûteux ne peut pas
masquer un chemin de récupération onéreux.

## La qualification précède le prix

Chaque candidat utilisé dans l’arbre doit satisfaire les exigences résolues de la tâche. Le planificateur vérifie les capacités, le niveau d’effort, les capacités de contexte et de sortie, la
frontière de confidentialité, l’utilisation pour l’entraînement, la conservation, les outils déclarés, les contrôles obligatoires, la disponibilité, la fraîcheur des preuves, la latence et la
séparation de la validation indépendante. Une preuve manquante ou obsolète exclut la proposition ; elle n’est jamais interprétée comme un prix nul ou une inconnue acceptable.

La politique d’outils s’applique aux outils que le plan déclare vouloir invoquer. Un candidat peut en prendre d’autres en charge sans enfreindre une règle d’interdiction. Lorsqu’une revue indépendante
est requise, au moins un nœud de validation doit utiliser un candidat et un domaine d’indépendance différents de ceux du nœud principal.

## Coût exact de l’arbre complet

Pour un nœud `v`, le planificateur calcule le coût p95 d’invocation à partir de chaque dimension facturable déclarée et du tarif normalisé. Sa probabilité d’être atteint est le produit des
probabilités conditionnelles depuis la racine. La valeur de classement est :

```text
expectedAggregateP95 = sum(reachProbability(v) * invocationP95(v))
```

Cette valeur est une agrégation attendue d’estimations p95 par nœud, et non le quantile statistique p95 de la facture finale. Le planificateur enregistre aussi le coût maximal non pondéré d’un chemin
terminal pour l’autorité budgétaire en aval.

Les montants et probabilités utilisent des rationnels de précision arbitraire réduits. Les comparaisons n’emploient jamais les nombres flottants et les montants affichés ne sont arrondis vers le haut
qu’une fois, à l’échelle déclarée. Toute dimension de consommation positive requiert un prix actuel correspondant ; toute dimension tarifée requiert une consommation explicite. Les devises mixtes sont
exclues tant qu’une couche de conversion gouvernée séparément n’existe pas. Un candidat local n’est gratuit que lorsque tous ses tarifs explicites sont nuls.

## Sélection déterministe et preuves sûres

Les arbres qualifiés sont ordonnés selon leur coût agrégé attendu exact. À coût égal, les règles de départage déclarées dans la politique s’appliquent dans l’ordre, puis l’identifiant canonique de la
proposition. L’ordre des entrées et celui du catalogue n’affectent pas le résultat. Un candidat plus capable ou avec un niveau d’effort supérieur reste éligible et l’emporte chaque fois que son arbre
complet qualifié est moins cher.

Le registre immuable de décision ne contient que des identifiants publics de candidats et de nœuds, les empreintes des exigences, politiques, catalogues et propositions, des références de preuve, les
coûts exacts, des codes d’exclusion stables et les décisions de départage. Il n’enregistre jamais les prompts de tâche, observations brutes, charges utiles fournisseur, configurations ou identifiants
secrets.

[L’autorisation budgétaire](/fr/guide/execution-budgets) compare l’arbre complet retenu à l’autorité dérivée de la session active visible par l’utilisateur. La
[replanification sûre](/fr/guide/execution-replanning) crée une nouvelle décision immuable après un échec d’exécution, un changement de périmètre ou une validation échouée, sans réécrire le plan
initial.

Les [explications de décision](/fr/guide/execution-explanations) projettent le registre et ses exclusions dans un contrat sûr destiné à l’interface, sans relancer le classement ni exposer les entrées
privées.
