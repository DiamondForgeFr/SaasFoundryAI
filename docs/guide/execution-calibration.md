# Execution outcomes and calibration

SaaSFoundry records what happened after dispatch separately from what the planner estimated. Authenticated outcomes support audit and explanation immediately; a bounded calibration snapshot may later
turn a qualified cohort of those outcomes into new estimate evidence for future plans.

## Authenticated outcome records

`recordExecutionOutcome` binds one normalized result to the exact run, lineage revision and head, attempt, dispatch permit, plan decision, proposal, node, candidate, retry ordinal, and calibration
cohort. The record includes only:

- normalized actual billable quantities;
- bounded latency;
- an allowlisted outcome code;
- validation result and executed check codes;
- optional retry, fallback, or replan reason;
- canonical occurrence and receipt timestamps;
- source kind and opaque evidence references.

The host verifies the provider settlement, runtime meter, or dispatch record and appends it atomically. Replaying the same event with the same canonical content returns the existing record. Reusing
the event key with different usage, bindings, or results is rejected, as is a second terminal result. Hashes detect accidental or caller-side tampering; durable authentication and compare-and-swap
storage remain host responsibilities.

`outcome-unknown`, cancelled, partially metered, and unmetered records remain useful audit evidence, but calibration censors them. They cannot report success, lower a p95 estimate, release a lineage
reservation, or authorize a retry.

## Isolated, bounded calibration

`deriveExecutionCalibrationSnapshot` accepts authenticated records for one exact cohort:

- canonical candidate and effort;
- runtime kind;
- workload class;
- privacy boundary;
- opaque tenant/security boundary.

This prevents restricted tenant evidence from entering a shared estimator. The policy also declares a cutoff, estimator version, minimum and maximum sample counts, nearest-rank quantile, per-dimension
usage caps, latency cap, generation time, expiry, and an opaque evidence reference. Caps bound the influence of one anomalous or poisoned sample. Records after the cutoff and records from another
cohort are excluded deterministically.

The immutable snapshot contains canonical source outcome IDs and a history fingerprint, calibrated usage and latency p95 estimates, exact rational outcome rates, and its validity window. Input order
does not change the snapshot.

## Forward-only evidence

`applyExecutionCalibrationToPlanEstimate` copies a proposal and replaces only the selected node's future usage/latency estimate evidence. It does not mutate the source proposal or change capabilities,
privacy, tools, prices, requirements, policy, session workload, authority, grants, reservations, lineage, or historical outcomes. Outcome rates remain explicit rational evidence for the host's
proposal builder; they are never silently rounded into a tree.

```ts
const outcome = recordExecutionOutcome(rawOutcome, expectedDispatchBinding, outcomeHost)
const snapshot = deriveExecutionCalibrationSnapshot(outcomes, cohort, calibrationPolicy, calibrationHost)
const futureProposal = applyExecutionCalibrationToPlanEstimate(previousProposal, 'primary', snapshot)
const futureDecision = selectMinimumCostExecutionPlan([futureProposal, ...alternatives], requirements, catalogue, policy)
```

The future decision must pass normal qualification and receive fresh [budget authority](./execution-budgets.md). A stale snapshot excludes the proposal through the existing estimate freshness checks.
Settled cost is audit and calibration evidence only; it never refunds the conservative p95 reservation used by [safe replanning](./execution-replanning.md).

## The same idea for the harness's own delegations

The coding agents of a managed harness delegate work to tier agents, and the [routing grid](../cli/sf-agents.md#delegation-routing-sf-agents-route) says which tier a task kind starts on. That grid is
a prior from public benchmarks. A project corrects it from its own runs with the same discipline as this page, in a lighter form, because a harness delegation has none of the planner bindings above
(run, lineage, dispatch permit, plan decision, proposal fingerprint): inventing them would produce evidence that looks authenticated and is not.

The [delegation ledger](../cli/sf-agents.md#measured-delegations-and-the-adjusted-routing) therefore keeps its own record and reuses what this library already defines:

- the **outcome codes** (`success`, `execution-failed`, `validation-failed`, `candidate-unavailable`, `outcome-unknown`, `cancelled`) and the **check codes** (`self-review`, `type-check`,
  `automated-tests`, `integration-tests`, `independent-review`, `security-tests`);
- the **secret filter** applied to every free-text field;
- the **censoring rule**: a run without a usable outcome is kept for audit and never counts as a success, a failure or a cost;
- **exact money**: decimal strings and exact rationals, rounded up once for display.

Where the planner calibrates a cohort's usage and latency for future estimates, the harness calibrates the **tier** a task kind runs on, from the success rate, the cost and the duration of its runs.
The decision compares the expected cost of delivering the work, failures included, so a cheap tier that fails often is expensive. A cheaper tier is only tried on a bounded share of the runs, and a
move is logged with its evidence, kept in a clone-local layer, shared only by `sf agents routing promote`, and undone by `sf agents routing reset`.
