# Routage adaptatif local et cloud

SaaSFoundry peut admettre un modèle installé localement dans le même catalogue de candidats indépendant des fournisseurs que celui utilisé par les adaptateurs cloud, puis comparer des plans complets
d’exécution locale, cloud, de validation, de nouvelle tentative et de repli. Le routage reste distinct de l’installation, de la qualification, du transport et de l’exécution : il produit une décision
immuable et un état d’autorité explicite.

## Frontière multiplateforme

Les contrats partagés de candidats, routage, confidentialité, repli, budget et explication sont indépendants du système d’exploitation. macOS, Linux et Windows fournissent des preuves normalisées sur
l’hôte et le runtime au moyen d’adaptateurs. Les runtimes Metal, CUDA, ROCm, DirectML, Vulkan et CPU peuvent participer lorsque leurs adaptateurs fournissent des preuves actuelles.

Les sondes propres à la plateforme collectent l’état du runtime, l’énergie en milliWattHours et la pression sur le périphérique. Une mesure locale obligatoire indisponible échoue en mode fermé selon
la politique de routage ; elle n’est jamais traitée comme nulle. Les plans exclusivement cloud peuvent déclarer l’énergie et la pression de l’hôte comme non applicables.

## Admettre un candidat local qualifié

`admitLocalExecutionCandidate` accepte uniquement une qualification actuelle par catégorie de tâche dont le profil, l’installation prête, le plan de benchmark, la suite, l’adaptateur, le validateur,
la politique de qualification, le condensat du modèle, la révision du runtime, la quantification, le contexte, la concurrence et la liaison à l’hôte correspondent toujours. L’hôte doit authentifier
l’attestation de transport ; une valeur seulement signée ou dotée d’une empreinte par l’agent est rejetée. L’attestation prouve que le runtime est sain et que prompts, sources, contenus générés,
trafic des outils, télémétrie, journaux, rapports de plantage et récupération ne peuvent pas quitter l’appareil.

La valeur admise utilise le contrat `ExecutionCandidate` normal :

- `runtime.kind` vaut `local` ;
- la disponibilité prend fin à la première expiration d’une preuve ;
- chaque dimension facturable prise en charge a un prix fournisseur explicitement nul ;
- la confidentialité est `local-device`, sans entraînement et avec une conservation nulle ;
- les capacités restent limitées à la catégorie de tâche ayant réussi la qualification ;
- la fenêtre de contexte annoncée ne peut pas dépasser le contexte stable mesuré pendant la qualification.

Une preuve rejetée, non concluante, obsolète, incohérente, dégradée, accessible à distance ou inconnue produit une exclusion stable. Une qualification dans une catégorie n’annonce jamais les capacités
d’une autre catégorie.

## Comparer des routes complètes

`selectAdaptiveExecutionRoute` soumet d’abord chaque proposition au moteur existant d’exigences et de coût exact. `ExecutionRoutingPolicy` déclare ensuite des seuils et un ordre de comparaison
déterministe explicite pour :

- le coût marginal attendu et maximal par chemin ;
- la latence maximale du chemin ;
- l’énergie mesurée ;
- la pression sur l’appareil local ;
- la probabilité d’échec ;
- l’exposition aux replis ;
- les préférences de runtime et de confidentialité ;
- le nombre de nœuds et les identifiants canoniques servant au départage.

Ces dimensions restent séparées. SaaSFoundry n’invente aucune conversion monétaire des millisecondes, de la température ou de l’énergie. Un candidat local à prix nul peut donc perdre si la politique
déclarée préfère un plan plus rapide, plus frais, plus fiable ou moins exposé aux replis.

Les nœuds de repli et de nouvelle tentative doivent être présents dans la proposition avant la sélection, porter leurs propres faits de candidat et de confidentialité et apparaître dans les preuves
actuelles de routage. Leur coût monétaire conditionnel est déjà inclus dans les totaux exacts, attendu et maximal par chemin.

## Confidentialité et autorité

Une exigence dont la seule frontière autorisée est `local-device` rejette tout nœud cloud ou hybride atteignable. Une approbation ne peut pas élargir cette contrainte stricte.

Lorsque les exigences autorisent le cloud et qu’un plan à racine locale contient un repli cloud, `authorizeAdaptiveExecutionRoute` crée un défi distinct de frontière cloud avant l’exécution initiale.
Il lie :

- les décisions de route et de plan budgétaire ;
- les empreintes de la proposition, des exigences, du catalogue, des politiques de planification et de routage et des preuves ;
- les nœuds et frontières cloud exacts ;
- un manifeste canonique d’exécution contenant les identifiants exacts des nœuds cloud et un condensat de chaque élément de contenu sortant ;
- les périmètres de contenu autorisés dérivés du manifeste, le déclencheur de repli, la justification et l’expiration.

Au moment de l’autorisation, l’hôte authentifie les preuves actuelles de routage et le manifeste d’exécution, puis SaaSFoundry recalcule la route retenue. L’approbation monétaire et celle de la
frontière cloud sont indépendantes. Une fois tous les contrôles réussis, l’hôte consomme atomiquement les événements d’approbation et émet un permis de routage lié à la proposition, au manifeste, aux
nœuds cloud et à la première expiration des preuves. Une replanification, une preuve obsolète, un candidat, contenu sortant, déclencheur ou politique modifié produit un autre défi ou permis et
invalide l’autorité précédente.

`dispatchAuthorized` ne devient vrai qu’après réussite de la barrière budgétaire exacte existante, validation de l’autorisation de frontière cloud lorsqu’elle est requise, satisfaction de toute autre
approbation indépendante de candidat ou d’outil et acceptation par l’hôte de la consommation finale de l’autorité.

Les adaptateurs cloud doivent envoyer les données au moyen de `dispatchAdaptiveCloud`. Cette barrière reçoit le permis, le manifeste approuvé, le nœud cloud cible et les octets réellement sortants.
Elle recalcule chaque condensat, rejette les contenus non déclarés ou modifiés, applique les plafonds d’octets par élément et agrégés avant le hachage, vérifie la route et l’expiration, consomme
atomiquement le permis à usage unique, puis seulement appelle le transport réseau. Une validation échouée n’atteint jamais le transport ; un permis ne peut pas être rejoué après sa première exécution.

## Explications sûres

`explainAdaptiveExecutionRoute` expose l’identifiant du plan retenu, l’identifiant du candidat, le motif de comparaison, les coûts exacts, les mesures opérationnelles agrégées, les nœuds de repli
visibles, les exclusions et l’état d’approbation. Il ne recopie jamais les prompts, le texte du dépôt ou des sources, le contenu généré, les charges utiles des outils, les secrets, chemins locaux ou
métadonnées brutes d’un adaptateur.
