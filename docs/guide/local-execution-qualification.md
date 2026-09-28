# Local execution qualification

An installed local model becomes eligible for a task class only after a versioned synthetic benchmark passes that class's performance and quality thresholds on the current host. Qualification is
separate from setup, candidate registration, routing, and live execution calibration. Passing this step records trustworthy evidence; it does not create or route an execution candidate.

## Benchmark boundary

`createLocalBenchmarkPlan` binds one run to the exact setup revision, host snapshot, profile policy, runtime source revision, model artifact revision and SHA-256 digest, format, quantization, context
and output limits, concurrency, benchmark suite, adapter, and deterministic host validator. The plan is immutable and fingerprinted. Its fixed isolation contract requires:

- a versioned synthetic corpus, without repository or user data;
- disabled network and repository access;
- mock tools, no persistence, and loopback-only binding;
- bounded iterations, warmups, per-sample timeouts, and total duration.

The runtime adapter reports measurements. A separate host validator evaluates structured output, tool use, instruction adherence, and code correctness. Adapters cannot mark their own output as valid.
Failures, timeouts, cancellations, invalid adapter responses, and validator failures remain as explicit samples instead of disappearing from the result.

Public evidence contains metrics, stable reason codes, fingerprints, and safe audit references. Prompts, completions, generated code, tool payloads, local paths, hostnames, process IDs, environment
variables, raw errors, URLs, and credentials are outside the contract.

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

## Eligibility by task class

Each policy threshold targets one existing task category: `mechanical`, `implementation`, `architecture`, `security`, or `data-sensitive`. A profile can therefore qualify for mechanical edits while
remaining rejected or inconclusive for implementation. Consumers must use the individual task-class decisions; the aggregate `qualified` status means that at least one declared class passed.

Measured samples, excluding warmups, determine:

- completed sample count and exact failure ratio;
- p95 startup and first-token latency;
- median throughput and minimum stable context;
- maximum system and accelerator memory pressure;
- minimum sustained throughput and observed thermal degradation;
- every quality check required by the policy.

Thresholds are inclusive. A value exactly on the boundary passes. A one-unit miss rejects that task class. Missing required metrics or unknown quality checks produce `inconclusive`; unknown thermal
state is reported but is not treated as observed degradation.

## Staleness and requalification

Qualification becomes `stale` when the plan or policy expires, or when the setup revision, host snapshot, discovery policy, runtime revision, model revision or digest, format, quantization,
configuration, suite, adapter, validator, or qualification policy differs from the current state. Every task-class decision is then stale, and `requiresRecommendation` tells the caller to restart at
profile recommendation before routing work.

Synthetic qualification evidence must stay separate from live [execution calibration](./execution-calibration.md). Qualification establishes controlled task-class capability on one host; calibration
learns from authorized production outcomes after routing exists.

A current per-task-category result can be admitted and selected through [adaptive local/cloud routing](./local-cloud-routing.md). Qualification alone never creates a candidate or authorizes dispatch.
