# Qualification de l’exécution locale

Un modèle local installé ne devient éligible à une classe de tâche qu’après la réussite d’un benchmark synthétique versionné selon les seuils de performance et de qualité de cette classe sur l’hôte
actuel. La qualification est distincte de l’installation, de l’enregistrement des candidats, du routage et du calibrage en conditions réelles. Réussir cette étape enregistre des preuves fiables ; cela
ne crée ni ne route un candidat d’exécution.

## Frontière du benchmark

`createLocalBenchmarkPlan` lie une exécution à la révision exacte de l’installation, à l’instantané de l’hôte, à la politique de profil, à la révision de la source du runtime, à la révision de
l’artefact du modèle et à son condensat SHA-256, au format, à la quantification, aux limites de contexte et de sortie, à la concurrence, à la suite de benchmark, à l’adaptateur et au validateur
déterministe de l’hôte. Le plan est immuable et doté d’une empreinte. Son contrat d’isolation fixe exige :

- un corpus synthétique versionné, sans données du dépôt ni de l’utilisateur ;
- l’accès au réseau et au dépôt désactivé ;
- des outils simulés, aucune persistance et une écoute limitée à la boucle locale ;
- des itérations, préchauffages, délais par échantillon et durée totale bornés.

L’adaptateur de runtime rapporte les mesures. Un validateur distinct côté hôte évalue la sortie structurée, l’utilisation des outils, le respect des instructions et la justesse du code. Les
adaptateurs ne peuvent pas valider leur propre sortie. Les échecs, délais dépassés, annulations, réponses invalides d’un adaptateur et erreurs du validateur restent des échantillons explicites au lieu
de disparaître du résultat.

Les preuves publiques contiennent des mesures, des codes de motif stables, des empreintes et des références d’audit sûres. Les prompts, réponses, code généré, charges utiles d’outils, chemins locaux,
noms d’hôte, identifiants de processus, variables d’environnement, erreurs brutes, URL et identifiants secrets restent hors du contrat.

```ts
import {
  createLocalBenchmarkPlan,
  createLocalBenchmarkSuite,
  createLocalQualificationPolicy,
  qualifyLocalBenchmark,
  resolveLocalBenchmarkCurrentState,
  runLocalBenchmark
} from 'saasfoundryai-cli/dist/execution'

const suite = createLocalBenchmarkSuite({
  version: 'local-benchmark-v1',
  corpusSha256,
  validatorVersion: 'host-validator-v1',
  tasks: syntheticTasks,
  evidenceRefs: ['benchmark-corpus:v1']
})

const plan = createLocalBenchmarkPlan({
  profile,
  proposal,
  record: readySetup,
  suite,
  adapterId: adapter.id,
  validatorId: validator.id,
  generatedAt,
  validUntil,
  iterations: 5,
  warmupIterations: 1,
  timeoutMs: 60_000,
  maximumTotalDurationMs: 900_000,
  evidenceRefs: ['benchmark-request:1']
})

const evidence = await runLocalBenchmark({
  plan,
  profile,
  proposal,
  record: readySetup,
  suite,
  adapter,
  validator,
  authority,
  evaluatedAt
})

const currentState = resolveLocalBenchmarkCurrentState({
  profile,
  proposal,
  record: readySetup,
  suite,
  adapterId: adapter.id,
  validatorId: validator.id
})

const qualification = qualifyLocalBenchmark({
  plan,
  evidence,
  suite,
  policy,
  currentState,
  currentQualificationPolicyId: policy.id,
  evaluatedAt
})
```

## Éligibilité par classe de tâche

Chaque seuil de politique cible une catégorie de tâche existante : `mechanical`, `implementation`, `architecture`, `security` ou `data-sensitive`. Un profil peut donc être qualifié pour des
modifications mécaniques tout en restant rejeté ou non concluant pour l’implémentation. Les consommateurs doivent utiliser les décisions de chaque classe ; le statut agrégé `qualified` signifie qu’au
moins une classe déclarée a réussi.

Les échantillons mesurés, hors préchauffage, déterminent :

- le nombre d’échantillons terminés et le taux exact d’échec ;
- les latences p95 de démarrage et du premier token ;
- le débit médian et le contexte stable minimal ;
- la pression maximale sur la mémoire système et d’accélérateur ;
- le débit soutenu minimal et la dégradation thermique observée ;
- chaque contrôle qualité requis par la politique.

Les seuils sont inclusifs : une valeur exactement sur la limite réussit, un écart d’une unité rejette la classe. Une mesure obligatoire manquante ou un contrôle qualité inconnu produit `inconclusive`
; un état thermique inconnu est signalé mais n’est pas traité comme une dégradation observée.

## Obsolescence et nouvelle qualification

La qualification devient `stale` à l’expiration du plan ou de la politique, ou lorsque la révision d’installation, l’instantané de l’hôte, la politique de découverte, la révision du runtime, la
révision ou le condensat du modèle, le format, la quantification, la configuration, la suite, l’adaptateur, le validateur ou la politique de qualification diffère de l’état actuel. Toutes les
décisions par classe deviennent alors obsolètes, et `requiresRecommendation` indique à l’appelant de reprendre à la recommandation de profil avant de router du travail.

Les preuves de qualification synthétiques doivent rester distinctes du [calibrage d’exécution](/fr/guide/execution-calibration) en conditions réelles. La qualification établit la capacité contrôlée
d’une classe de tâche sur un hôte ; le calibrage apprend des résultats de production autorisés une fois le routage en place.

Un résultat actuel par catégorie peut être admis et sélectionné au moyen du [routage adaptatif local/cloud](/fr/guide/local-cloud-routing). La qualification seule ne crée jamais de candidat et
n’autorise aucune exécution.
