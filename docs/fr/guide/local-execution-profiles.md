# Profils d’exécution locale

SaaSFoundry transforme un [instantané récent des capacités de l’hôte](/fr/guide/host-capabilities) et les observations des adaptateurs de runtime en profils d’exécution locale classés. Un profil est
une recommandation d’installation complète : il nomme le backend du runtime, l’artefact du modèle et son condensat, la quantification, les limites de contexte et de sortie, la concurrence, la latence
attendue, l’adéquation à la charge et les ressources requises.

Le moteur de recommandation travaille en lecture seule. Il ne télécharge aucun artefact, n’installe aucun runtime, ne démarre aucun service, ne mesure aucun modèle et ne crée aucun
[candidat d’exécution](/fr/guide/execution-candidates). Un profil retenu devient une [proposition d’installation locale](/fr/guide/local-execution-setup) immuable et révisable avant toute modification
de l’hôte. Après l’installation, la [qualification de l’exécution locale](/fr/guide/local-execution-qualification) mesure les classes de tâches que le profil installé peut traiter. L’intégration au
routage reste une étape distincte du cycle de vie.

```ts
import { collectHostInferenceCapabilities, recommendLocalExecutionProfiles } from 'saasfoundryai-cli/dist/execution'

const host = await collectHostInferenceCapabilities({
  workingDirectory: process.cwd()
})

const recommendation = await recommendLocalExecutionProfiles(host, runtimeAdapters, {
  evaluatedAt: new Date().toISOString()
})
```

Chaque adaptateur découvre des enregistrements propres à son runtime et les normalise dans le même contrat fermé. Le moteur commun de recommandation ne contient aucune branche sur le nom d’un runtime
ou d’un fournisseur de modèles. Les échecs d’adaptateur et les enregistrements invalides deviennent des codes d’exclusion sûrs ; réponses brutes, erreurs, chemins locaux, URL et identifiants secrets
n’entrent pas dans le résultat.

## Classement et compromis

La politique par défaut classe les profils viables dans cet ordre :

1. adéquation à la charge, en privilégiant le développement et le travail interactif ;
2. runtime optimisé pour l’hôte avant le runtime portable ;
3. estimation de latence p95 plus faible ;
4. limites de contexte et de concurrence plus grandes ;
5. besoins plus faibles en mémoire et en disque ;
6. identité stable du profil comme dernier critère de départage.

La sortie enregistre ces compromis au lieu de retourner seulement un nom de modèle. Chaque profil contient des chaînes décimales exactes d’octets pour le téléchargement de l’artefact, sa taille
installée, la mémoire système et d’accélérateur, ainsi que les besoins calculés avec marge. Son identité inclut le condensat de l’artefact : un artefact modifié ne peut pas réutiliser silencieusement
l’identité d’un profil antérieur.

Les applications peuvent créer une autre `LocalExecutionProfilePolicy` immuable avec empreinte pour modifier l’ordre des charges, préférer les runtimes portables, relever le niveau minimal de l’hôte,
augmenter les réserves ou réduire le nombre de profils retournés. Les planchers de sécurité intégrés empêchent de descendre sous 2 Gio de mémoire pour le système d’exploitation, 2 Gio pour le
développement, 1 Gio de mémoire d’accélérateur et 8 Gio de stockage.

## Qualification des ressources

La qualification préserve des capacités pour le système d’exploitation et le développement actif pendant l’exécution du modèle :

| Organisation de la mémoire | Règle de qualification                                                                                                                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CPU/système                | La mémoire système du modèle, plus les réserves du système et du développeur, doit tenir dans la mémoire totale ; le modèle et la réserve du développeur doivent tenir dans la mémoire actuellement disponible. |
| Unifiée/partagée           | Les allocations système et accélérateur partagent le même ensemble de l’hôte et sont comptées une fois chacune, avec les réserves système et accélérateur.                                                      |
| Dédiée                     | La mémoire système est vérifiée séparément. La mémoire d’accélérateur du modèle et sa réserve doivent tenir sur un périphérique compatible. Plusieurs périphériques ne sont jamais additionnés.                 |

La qualification du disque inclut la taille téléchargée, la taille installée et la réserve de stockage, car les fichiers téléchargés et installés peuvent coexister pendant l’installation. Une capacité
requise inconnue, un backend non pris en charge, une preuve obsolète ou un manque d’un seul octet exclut le profil.

## Décisions de ne pas installer

`status: "no-install-recommended"` est un résultat volontaire. Il est retourné pour un hôte non pris en charge ou obsolète, un hôte sous le niveau configuré, l’absence d’adaptateur ou d’observation,
ou l’absence de profil viable. Des codes stables de contrainte et d’exclusion expliquent la décision sans encourager un téléchargement optimiste.

Les recommandations sont immuables et dotées d’une empreinte. Une nouvelle exécution avec les mêmes preuves canoniques de l’hôte, profils d’adaptateur, politique et date d’évaluation produit le même
résultat ordonné, quel que soit l’ordre des adaptateurs ou observations.
