# Exigences d’exécution

SaaSFoundry classe une tâche avant de considérer les fournisseurs, runtimes, modèles ou prix. Le classificateur transforme l’intention de la tâche en un ensemble immuable d’exigences indépendant des
fournisseurs, que les couches de planification suivantes peuvent inspecter et réutiliser.

```text
Intention de la tâche → Exigences d’exécution → Catalogue de candidats → Classement et plan
```

Cette frontière empêche le catalogue disponible d’abaisser le niveau de qualité ou de sécurité requis par le travail. Un candidat peu coûteux ne peut être bien classé qu’après avoir satisfait
l’ensemble d’exigences.

## Ensemble d’exigences

L’artefact normalisé enregistre :

| Domaine         | Signification                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Classification  | Catégories de tâche normalisées, risque évalué, version du classificateur et codes de preuve sûrs                             |
| Capacités       | Capacités indépendantes du fournisseur requises et effort de raisonnement minimal                                             |
| Validation      | Rigueur et contrôles minimaux, par exemple vérification des types, tests automatisés, revue indépendante ou tests de sécurité |
| Latence         | Priorité interactive, équilibrée ou débit, avec un plafond optionnel de latence du plan                                       |
| Contexte        | Capacités minimales d’entrée et de sortie et possibilité de partitionner la tâche                                             |
| Confidentialité | Frontières d’exécution autorisées, utilisation pour l’entraînement et plafond de conservation                                 |
| Outils          | Identifiants d’outils requis et interdits, ainsi que les approbations nécessaires                                             |
| Résolution      | Chaque dérogation appliquée ou rejetée et tout conflit impossible à satisfaire                                                |

L’artefact possède un identifiant SHA-256 stable. Le texte de la tâche est normalisé et haché séparément, puis supprimé. Les prompts bruts, identifiants secrets, réponses fournisseur, noms de
fournisseur, de runtime et de modèle ne font pas partie de l’ensemble public d’exigences.

## Profils de référence

Plusieurs catégories peuvent s’appliquer à une tâche. SaaSFoundry les combine en retenant les exigences compatibles les plus strictes.

| Catégorie         | Risque   | Effort minimal | Validation minimale         | Mode de contexte |
| ----------------- | -------- | -------------- | --------------------------- | ---------------- |
| Mécanique         | Faible   | Faible         | Contrôles automatisés       | Partitionnable   |
| Implémentation    | Moyen    | Moyen          | Contrôles automatisés       | Partitionnable   |
| Architecture      | Élevé    | Élevé          | Revue indépendante          | Candidat unique  |
| Sécurité          | Critique | Très élevé     | Revue indépendante et tests | Candidat unique  |
| Données sensibles | Élevé    | Élevé          | Revue indépendante et tests | Candidat unique  |

Un travail inconnu utilise par prudence le profil d’implémentation. Des signaux explicites comme un impact en production, des opérations destructrices, des migrations, des secrets ou des données
restreintes peuvent ajouter des catégories plus strictes.

## Contraintes du workflow et de l’utilisateur

Les contraintes du workflow sont appliquées en premier, puis les contraintes explicites de l’utilisateur. Les dérogations sont monotones : elles peuvent ajouter ou renforcer des exigences, mais jamais
affaiblir un plancher de sécurité existant.

| Contrainte                                                                  | Règle de fusion                                   |
| --------------------------------------------------------------------------- | ------------------------------------------------- |
| Capacités, contrôles et outils requis                                       | Union                                             |
| Effort, validation, contexte et sortie minimaux                             | Exigence la plus stricte ou minimum le plus élevé |
| Plafonds de latence et de conservation                                      | Plafond le plus bas                               |
| Frontières de confidentialité et utilisation pour l’entraînement autorisées | Intersection                                      |
| Approbation requise                                                         | OU logique                                        |

Chaque décision conserve sa source, sa référence sûre, son champ, son résultat, son motif et le fait qu’elle s’applique seulement à la tâche actuelle ou aussi aux replanifications futures. Une
intersection de confidentialité vide ou un conflit entre outil requis et interdit rend le résultat `unsatisfiable` ; le planificateur doit s’arrêter au lieu de deviner.

## Réutilisation pendant la planification

```ts
const requirements = classifyTaskIntent(
  {
    text: 'Review authentication and secret handling',
    signals: { operation: 'security-review', handlesSecrets: true }
  },
  {
    workflowConstraints: [workflowPolicy],
    userConstraints: [userPolicy]
  }
)

// Pass the same immutable artifact to catalogue filtering, ranking, retries,
// and replanning. Do not classify again unless the task or policy changes.
```

La sérialisation préserve l’artefact complet de décision. Une étape de planification ultérieure peut donc consommer les mêmes exigences sans répéter la classification. Les adaptateurs fournisseur
restent uniquement responsables de la découverte et de la normalisation des candidats ; le classement et la politique budgétaire appartiennent à des couches distinctes.
