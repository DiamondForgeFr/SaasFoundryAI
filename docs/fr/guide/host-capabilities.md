# Inspection des capacités de l’hôte

SaaSFoundry peut inspecter la machine actuelle avant qu’un adaptateur de runtime local ne propose des modèles. Cette inspection en lecture seule retourne un instantané immuable exploitable par une
machine. Elle n’installe aucun runtime, ne télécharge aucun modèle, ne démarre aucun service et ne lance aucun benchmark.

```ts
import { collectHostInferenceCapabilities } from 'saasfoundryai-cli/dist/execution'

const snapshot = await collectHostInferenceCapabilities({
  workingDirectory: process.cwd()
})
```

L’instantané enregistre :

- la famille du système d’exploitation et l’architecture ;
- les cœurs CPU logiques et physiques avec des identifiants de fonctions bornés ;
- le backend d’accélération, la classe du périphérique, le type et la capacité de mémoire lorsqu’ils peuvent être établis de manière sûre ;
- la mémoire totale et actuellement disponible ;
- l’espace disponible sur le système de fichiers contenant le répertoire de travail ;
- une décision de viabilité à durée limitée et l’empreinte de la politique utilisée pour l’établir.

Chaque fait possède un état : `observed`, `unknown`, `unavailable` ou `failed`. Un fait non observé n’a aucune valeur et inclut un code de motif stable. Les consommateurs doivent préserver ces
distinctions au lieu d’interpréter une preuve manquante comme une capacité nulle.

## Niveaux de viabilité prudents

La politique versionnée par défaut classe un hôte comme `unsupported`, `background-only`, `interactive`, `coding-capable` ou `high-capability`. La classification part du niveau le plus élevé et ne
retient un niveau que lorsque chaque fait requis satisfait son seuil. La décision précise pourquoi l’hôte n’a pas atteint le niveau supérieur. Un système d’exploitation, une architecture, une capacité
ou une preuve d’accélérateur obligatoire inconnus empêchent la promotion.

Le niveau décrit uniquement la viabilité de la machine. Chaque décision conserve donc `model-fit-not-established` et `runtime-availability-not-established`. Les
[profils d’exécution locale](/fr/guide/local-execution-profiles) combinent cet instantané aux preuves des adaptateurs de runtime et de modèle avant toute proposition d’installation.

Les seuils par défaut sont des entrées prudentes de la politique et non des promesses sur un modèle particulier :

| Niveau                  | Cœurs logiques | Mémoire totale | Mémoire disponible | Disque disponible | Mémoire accélérateur |
| ----------------------- | -------------: | -------------: | -----------------: | ----------------: | -------------------: |
| Haute capacité          |              8 |         64 Gio |             16 Gio |            64 Gio |       32 Gio, requis |
| Capable de développer   |              8 |         32 Gio |              8 Gio |            32 Gio |       16 Gio, requis |
| Interactif              |              4 |         16 Gio |              4 Gio |            16 Gio |           Non requis |
| Arrière-plan uniquement |              2 |          8 Gio |              2 Gio |             8 Gio |           Non requis |

Les appelants peuvent fournir une autre `HostViabilityPolicy` dotée d’une empreinte. Les politiques conservent le même ordre de quatre niveaux et la même représentation exacte des octets sous forme de
chaînes afin que les décisions restent déterministes entre JSON et les frontières de processus.

## Frontière des sondes

Le collecteur par défaut utilise les API Node pour le système d’exploitation, l’architecture, les cœurs logiques, la mémoire et la capacité du système de fichiers. L’enrichissement spécifique à une
plateforme est limité à des sources fixes :

- macOS : exécutables absolus `sysctl` et `system_profiler` avec des arguments littéraux ;
- Linux : analyse bornée de `/proc/cpuinfo` et requête absolue `nvidia-smi` lorsqu’elle est disponible ;
- Windows : une requête CIM PowerShell absolue, non interactive, avec un script littéral.

Les commandes s’exécutent sans shell, avec un environnement minimal, un délai de deux secondes et une sortie bornée. Les instantanés publics ne contiennent que des faits normalisés placés sur liste
blanche et des identifiants de source. Les sorties brutes, erreurs, noms d’hôte, noms de périphérique, chemins du système de fichiers, variables d’environnement et identifiants secrets ne sont jamais
copiés dans le contrat.

La mémoire d’accélération des puces Apple est signalée comme mémoire unifiée après observation de la prise en charge de Metal ; elle n’est jamais décrite comme de la VRAM dédiée. Sous Windows, la
mémoire du contrôleur vidéo ne prouve pas la présence d’un backend DirectML : le backend reste inconnu tant qu’un adaptateur de runtime ne l’a pas établi.

Les tests peuvent injecter un `HostProbeSystem` pour simuler des hôtes pris en charge, incomplets ou défaillants, sans lire la machine de CI ni démarrer les outils de plateforme. Les appelants en
production doivent utiliser le système par défaut et traiter `validUntil` comme une limite stricte de fraîcheur avant de planifier une exécution locale.
