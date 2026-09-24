# Candidats d’exécution

SaaSFoundry distingue la prise en charge des agents de développement de l’exécution des modèles.

- Un **profil d’agent de développement** décrit comment un hôte tel que Claude Code, Codex, Gemini CLI, Kimi Code ou Qwen Code découvre les instructions et les skills du projet. `sf agents` gère ces
  profils.
- Un **candidat d’exécution** est l’association d’un modèle et d’un niveau d’effort que l’hôte actif peut exécuter directement ou par délégation. Les candidats peuvent provenir d’un fournisseur cloud,
  d’un runtime local ou d’un environnement hybride.

Cette séparation permet à plusieurs développeurs d’utiliser différents agents dans le même dépôt, tandis qu’un routeur d’exécution ne compare que les candidats réellement accessibles depuis l’hôte
actif.

Pour l’exécution locale, [l’inspection des capacités de l’hôte](/fr/guide/host-capabilities) établit ce que la machine actuelle peut prendre en charge. Les
[profils d’exécution locale](/fr/guide/local-execution-profiles) qualifient ensuite des configurations complètes de runtime et de modèle. Une étape ultérieure d’installation et de benchmark peut
exposer un profil qualifié comme candidat d’exécution.

## Contrat indépendant des fournisseurs

Chaque adaptateur de fournisseur ou de runtime normalise ses enregistrements dans le même contrat :

| Domaine         | Preuves enregistrées                                                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identité        | Identifiants stables du candidat, du fournisseur, du runtime, du modèle et du niveau d’effort                                                                      |
| Capacité        | Limites de contexte et de sortie, ainsi que des identifiants de capacités indépendants du fournisseur                                                              |
| Disponibilité   | État, date d’observation, expiration et motif exploitable par une machine en cas d’indisponibilité                                                                 |
| Prix            | Dimensions horodatées exprimées en montants décimaux, devise, unité normalisée, dénominateur et unité d’origine du fournisseur                                     |
| Confidentialité | Frontière d’exécution, résidence lorsqu’elle est connue, politique d’utilisation pour l’entraînement et durée de conservation normalisée ou explicitement inconnue |
| Outils          | Mode d’invocation, outils pris en charge, appels parallèles et comportement d’approbation                                                                          |
| Provenance      | Adaptateur, référence d’enregistrement du fournisseur et date de récupération                                                                                      |

Les identifiants d’effort, libellés et unités tarifaires propres au fournisseur restent associés à leurs valeurs normalisées pour l’audit et le recalibrage. Le contrat commun est une liste blanche
explicite : les adaptateurs ne peuvent pas joindre de réponses brutes, de configuration fournisseur ni de métadonnées opaques. Les identifiants secrets restent derrière la frontière de l’adaptateur.
La validation du runtime rejette aussi les formats d’identifiants secrets reconnaissables dans tous les champs de texte publics, et le catalogue ne recopie jamais les erreurs brutes d’un adaptateur
dans un instantané.

## Vues éligibles et exclues

Le catalogue produit un instantané horodaté avec deux vues :

- `eligible` contient les candidats disponibles dont les preuves de disponibilité et de prix sont encore valides ;
- `excluded` conserve une identité sûre et un motif déterministe tel que `candidate-unavailable`, `catalogue-stale`, `invalid-candidate` ou `duplicate-candidate`.

Les consommateurs n’ont donc pas à deviner si un modèle absent était indisponible, obsolète, mal formé ou ambigu. L’échec d’un adaptateur est également enregistré sans exposer son erreur brute,
susceptible de contenir des informations sur le fournisseur ou l’authentification.

## Frontière de l’adaptateur

Un adaptateur prend en charge la découverte et la normalisation propres à son fournisseur. Le catalogue partagé ne connaît que cette interface :

```ts
interface ExecutionCandidateAdapter {
  readonly id: string
  discover(): Promise<readonly ExecutionCandidateObservation[]>
  normalize(observation: ExecutionCandidateObservation): ExecutionCandidate
}
```

Ajouter un fournisseur ou un runtime local revient à enregistrer un adaptateur supplémentaire. Cela n’ajoute aucune branche spécifique à un fournisseur dans les skills de workflow portables et ne
modifie pas `modules.harness.agents`.

Ce premier contrat s’arrête volontairement avant la classification des tâches, le classement des plans, l’approbation budgétaire, la politique de reprise et le calibrage. Ces couches consomment des
instantanés immuables du catalogue afin de pouvoir expliquer les preuves et les prix ayant motivé une décision.
