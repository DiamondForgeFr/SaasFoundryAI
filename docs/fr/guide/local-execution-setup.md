# Installation de l’exécution locale

Un [profil d’exécution locale](/fr/guide/local-execution-profiles) retenu peut être transformé en proposition d’installation immuable. Cette proposition constitue la frontière de revue entre une
recommandation en lecture seule et une modification de l’hôte : elle identifie les sources et révisions du runtime et du modèle, les licences, les estimations exactes de disque et de mémoire,
l’activité réseau, la persistance du service, l’adresse d’écoute, l’emplacement de stockage et chaque opération prévue avant approbation.

Le cycle de vie commun est indépendant du runtime et du modèle. Des adaptateurs propres au runtime implémentent des opérations typées ; le coordinateur ne contient aucune branche sur les noms de
fournisseurs et n’accepte jamais de chaînes de commande, chemins absolus, identifiants secrets, charges utiles fournisseur ni URL avec paramètres de requête dans ses contrats publics.

## Consentements indépendants

Le consentement est limité à une opération exacte d’une proposition dotée d’une empreinte. Les actions suivantes demandent des décisions indépendantes :

- installer ou mettre à jour le runtime ;
- télécharger l’artefact du modèle ;
- démarrer le service à l’ouverture de session, si demandé ;
- exposer le service au-delà de la boucle locale, si demandé.

Chaque action peut être refusée indépendamment. Refuser une opération requise sur le runtime ou le modèle suspend l’installation. Refuser la persistance optionnelle ou l’exposition réseau enregistre
l’opération ignorée et poursuit avec la configuration transitoire limitée à la boucle locale, plus sûre. Changer de source, révision, port, choix de persistance ou adresse d’écoute modifie l’identité
de la proposition ; un consentement antérieur ne peut donc pas autoriser le nouveau plan.

```ts
import { createLocalSetupConsent, createLocalSetupProposal, createLocalSetupRecord, resumeLocalSetup } from 'saasfoundryai-cli/dist/execution'

const proposal = createLocalSetupProposal({
  profile,
  generatedAt,
  validUntil,
  runtime: {
    sourceRef: 'catalogue:runtime:portable',
    sourceRevision: 'v1',
    licenseRef: 'license:mit',
    installSizeBytes: '1073741824',
    networkActivity: 'download'
  },
  model: {
    sourceRef: 'catalogue:model:coder',
    sourceRevision: profile.artifact.revision,
    licenseRef: 'license:apache-2.0',
    networkActivity: 'download'
  },
  service: {
    persistence: 'none',
    binding: { scope: 'loopback', addressRef: 'loopback', port: 11434 }
  },
  storage: { rootRef: 'sf-store:local-models', outsideGeneratedRepository: true },
  evidenceRefs: ['catalogue:local:v1']
})

const record = createLocalSetupRecord(proposal, createdAt)
const runtimeOperation = proposal.operations.find((operation) => operation.consentScope === 'runtime-install')!
const runtimeConsent = createLocalSetupConsent(proposal, {
  operationId: runtimeOperation.id,
  decision: 'approved',
  decidedAt,
  validUntil: consentValidUntil,
  actorRef: 'user:owner',
  nonceRef: 'decision:runtime:1'
})

const result = await resumeLocalSetup({
  proposal,
  record,
  consents: [runtimeConsent],
  adapter,
  authority,
  store,
  evaluatedAt
})
```

Le premier appel s’arrête à la prochaine décision manquante et retourne le périmètre de consentement en attente. Fournir cette décision puis rappeler `resumeLocalSetup` reprend depuis la révision
persistée sans répéter les opérations terminées.

Une installation prête n’est toujours pas éligible au travail. Elle doit réussir la [qualification propre à l’hôte](/fr/guide/local-execution-qualification), qui lie les preuves du benchmark à cette
révision exacte de l’installation, à la source du runtime, au condensat de l’artefact du modèle, à la quantification, à la configuration, à l’instantané de l’hôte et à la politique.

## Intégrité et reprise

Le stockage d’état utilise des révisions en comparaison-échange et se situe hors du dépôt de l’application générée. Chaque opération reçoit une clé d’idempotence déterministe et l’état est persisté
après chaque opération terminée ou ignorée. Un plantage ou un refus d’écriture concurrente ne peut pas rejouer silencieusement une modification acceptée.

Les téléchargements de modèles restent en zone intermédiaire jusqu’à ce que leur condensat SHA-256 déclaré corresponde au profil choisi et que leur nombre d’octets ne dépasse pas l’estimation revue.
L’adaptateur peut alors seulement activer le modèle. Les adaptateurs doivent exécuter des appels de processus typés sans shell, appliquer les plafonds d’octets de la proposition, conserver les preuves
détaillées dans le stockage d’audit géré par l’hôte et activer atomiquement les artefacts vérifiés.

## Aperçu de la suppression

La suppression commence par `createLocalRemovalPreview`. Cet aperçu immuable est lié à la révision exacte de l’installation et énumère chaque ressource possédée, son action et les octets récupérables.
Les runtimes partagés sont conservés ; seules les ressources marquées comme possédées et non partagées sont supprimées.

`createLocalRemovalConsent` enregistre une décision distincte pour cet aperçu. Une révision d’installation modifiée rend l’aperçu et son consentement obsolètes ; `removeLocalSetup` se met alors en
pause avant d’appeler l’adaptateur. La suppression est également reprenable et enregistre chaque ressource supprimée avant de passer à la suivante.
