# Adaptive local and cloud routing

SaaSFoundry can admit a locally installed model into the same provider-neutral candidate catalogue used by cloud adapters, then compare complete local, cloud, validation, retry, and fallback plans.
Routing remains separate from installation, qualification, transport, and dispatch: it produces an immutable decision and explicit authority state.

## Cross-platform boundary

Shared candidate, routing, privacy, fallback, budget, and explanation contracts are independent of the operating system. macOS, Linux, and Windows provide normalized host and runtime evidence through
adapters. Metal, CUDA, ROCm, DirectML, Vulkan, and CPU runtimes can participate when their adapters provide current evidence.

Platform-specific probes collect runtime health, energy in milliWattHours, and device pressure. An unavailable required local metric fails closed under the routing policy; it is never treated as zero.
Cloud-only plans can declare host energy and pressure as not applicable.

## Admit a qualified local candidate

`admitLocalExecutionCandidate` accepts only a current per-task-category qualification whose profile, ready setup, benchmark plan, suite, adapter, validator, qualification policy, model digest, runtime
revision, quantization, context, concurrency, and host binding still match. The host must authenticate the transport attestation; a value signed or fingerprinted only by the agent is rejected. The
attestation proves that the runtime is healthy and that prompts, source, generated content, tool traffic, telemetry, logs, crash reports, and retrieval cannot leave the device.

The admitted value uses the normal `ExecutionCandidate` contract:

- `runtime.kind` is `local`;
- availability ends at the earliest proof expiry;
- every supported billable dimension has an explicit zero provider price;
- privacy is `local-device`, no training, zero retention;
- capabilities remain scoped to the task category that passed qualification;
- the advertised context window cannot exceed the stable context measured during qualification.

Rejected, inconclusive, stale, mismatched, degraded, remote-capable, or unknown evidence returns a stable exclusion. Qualification for one category never advertises another category's capabilities.

## Compare complete routes

`selectAdaptiveExecutionRoute` first sends every proposal through the existing requirement and exact-cost engine. `ExecutionRoutingPolicy` then declares thresholds and an explicit deterministic
comparison order for:

- marginal expected and maximum-path money;
- maximum-path latency;
- measured energy;
- local device pressure;
- failure probability;
- fallback exposure;
- runtime and privacy preferences;
- node count and canonical identity tie-breakers.

These dimensions remain separate. SaaSFoundry does not invent a currency conversion for milliseconds, thermals, or energy. A zero-price local candidate can therefore lose when the declared policy
prefers a faster, cooler, more reliable, or lower-fallback plan.

Fallback and retry nodes must be present in the proposal before selection, carry their own candidate and privacy facts, and appear in current routing evidence. Their conditional monetary cost is
already included in the existing exact expected and maximum-path totals.

## Privacy and authority

A requirement whose only allowed boundary is `local-device` rejects any reachable cloud or hybrid node. Approval cannot widen this hard constraint.

When the requirements permit cloud use and a local-root plan contains a cloud fallback, `authorizeAdaptiveExecutionRoute` creates a separate cloud-boundary challenge before initial dispatch. It binds:

- the route and budget-plan decisions;
- proposal, requirements, catalogue, planning-policy, routing-policy, and evidence fingerprints;
- the exact cloud nodes and boundaries;
- a canonical dispatch manifest containing the exact cloud node IDs and a digest for every outbound content part;
- the permitted content scopes derived from that manifest, fallback trigger, rationale, and expiry.

At authorization time, the host authenticates current routing evidence and the dispatch manifest, and SaaSFoundry recomputes the selected route. Monetary approval and cloud-boundary approval are
independent. After every check passes, the host atomically consumes the approval events and issues one route permit bound to the exact proposal, manifest, cloud nodes, and earliest proof expiry.
Replanning, stale evidence, a changed candidate, outbound content, trigger, or policy produces a different challenge or permit and invalidates the previous authority.

`dispatchAuthorized` becomes true only after the existing exact budget gate passes, the cloud-boundary grant is valid when required, every other independent candidate/tool approval is satisfied, and
the host accepts the final authority consumption.

Cloud adapters must send data through `dispatchAdaptiveCloud`. This gate accepts the permit, approved manifest, target cloud node, and actual outbound bytes. It recomputes every part digest, rejects
undeclared or altered content, enforces the configured per-part and aggregate byte ceilings before hashing, verifies the route and expiry, atomically consumes the one-time permit, and only then calls
the network transport. Failed validation never reaches the transport; a permit cannot be replayed after its first dispatch.

## Safe explanations

`explainAdaptiveExecutionRoute` exposes the selected plan ID, candidate ID, comparison reason, exact costs, aggregate operational metrics, visible fallback nodes, exclusions, and approval state. It
never copies prompts, repository/source text, generated content, tool payloads, secrets, local paths, or raw adapter metadata.
