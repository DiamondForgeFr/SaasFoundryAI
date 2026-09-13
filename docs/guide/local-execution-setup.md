# Local execution setup

A selected [local execution profile](./local-execution-profiles.md) can be converted into an immutable setup proposal. The proposal is the review boundary between a read-only recommendation and host
mutation: it identifies the runtime and model sources and revisions, licenses, exact disk and memory estimates, network activity, service persistence, binding, storage location, and every planned
operation before approval.

The common lifecycle is runtime and model agnostic. Runtime-specific adapters implement typed operations; the coordinator never branches on vendor names and never accepts command strings, absolute
paths, credentials, provider payloads, or URLs with query parameters in its public contracts.

## Independent consent

Consent is scoped to one exact operation in one fingerprinted proposal. The following actions require independent decisions:

- installing or updating the runtime;
- downloading the model artifact;
- starting the service at login, when requested;
- exposing the service beyond loopback, when requested.

Each action can be declined independently. Declining a required runtime or model action pauses setup. Declining optional persistence or network exposure records the skipped operation and continues
with the safer transient, loopback configuration. Changing a source, revision, port, persistence choice, or binding changes the proposal identity, so earlier consent cannot authorize the new plan.

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

The first call stops at the next missing decision and returns its pending consent scope. Supplying that decision and calling `resumeLocalSetup` again continues from the persisted revision without
repeating completed work.

## Integrity and resumability

The state store uses compare-and-swap revisions and lives outside the generated application repository. Every operation receives a deterministic idempotency key, and state is persisted after each
completed or skipped operation. A crash or rejected concurrent write cannot silently replay an accepted mutation.

Model downloads remain staged until their reported SHA-256 digest matches the selected profile and their byte count stays within the reviewed estimate. Only then may the adapter activate the model.
Adapters should execute typed process calls without a shell, enforce the proposal's byte ceilings, keep detailed evidence in their host-managed audit store, and activate verified artifacts atomically.

## Removal preview

Removal starts with `createLocalRemovalPreview`. The immutable preview is bound to the exact setup revision and lists each owned resource, its action, and reclaimable bytes. Shared runtimes are
retained; only resources marked as owned and non-shared are deleted.

`createLocalRemovalConsent` records a separate decision for that preview. A changed setup revision makes both the preview and its consent stale, so `removeLocalSetup` pauses before calling the
adapter. Removal is also resumable and records every deleted resource before moving to the next one.
