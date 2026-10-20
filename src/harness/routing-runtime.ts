import { readLedger, resolveLedgerDir, type LedgerState } from './delegation-ledger'
import { readProjectRouting, type ProjectRouting } from './project-routing'
import { adjustRouting, selectTrial, type AdjustContext, type AdjustOutcome, type TrialOffer } from './routing-adjust'
import { autoKindsFor, emptyLocalRouting, readLocalRouting, staleTierAgentPaths, updateLocalRouting, type LocalAdjustment, type LocalRouting } from './routing-local'
import { resolveRoute, type ResolvedRoute, type RoutingProvider, type TaskKind } from './routing-grid'

/**
 * Everything one routing question needs, read once: the project's shared routing and policy, the clone's
 * ledger and its local layer. Outside a Git checkout there is no clone, hence no ledger and no local
 * layer: the shipped grid and the shared overrides answer alone.
 */
export interface RoutingState {
  root: string
  /** The clone-private directory; undefined outside a Git checkout. */
  dir: string | undefined
  project: ProjectRouting
  ledger: LedgerState
  local: LocalRouting
}

/**
 * Read the routing state of the clone of `root`. The project's own routing fails closed (an unreadable
 * manifest or an invalid block is an error). A damaged ledger or local layer is an error too, unless the
 * caller can live without them (`onDamaged`): `sf agents route` must keep answering from the shared
 * routing, saying what it could not read.
 */
export async function loadRoutingState(root: string, options: { project?: ProjectRouting; onDamaged?: (message: string) => void } = {}): Promise<RoutingState> {
  const project = options.project ?? (await readProjectRouting(root))
  const dir = await resolveLedgerDir(root)
  const empty = { runs: [], skipped: 0, unmatchedSignals: 0 }
  if (!dir) return { root, dir, project, ledger: empty, local: emptyLocalRouting() }
  try {
    return { root, dir, project, ledger: await readLedger(dir), local: await readLocalRouting(dir) }
  } catch (error) {
    if (!options.onDamaged) throw error
    options.onDamaged(error instanceof Error ? error.message : String(error))
    return { root, dir, project, ledger: empty, local: emptyLocalRouting() }
  }
}

export const contextOf = (state: RoutingState, now: Date = new Date()): AdjustContext => ({
  shared: state.project.routing,
  local: state.local,
  policy: state.project.policy,
  runs: state.ledger.runs,
  now
})

export interface RoutedKind extends ResolvedRoute {
  /** The route is a sample of the cheaper tier below the one the kind is routed to. */
  trial: boolean
  /** With a trial, the tier the kind is routed to. */
  effectiveTier: string | null
  /** The automatic move behind an `auto` route. */
  adjustment: (Pick<LocalAdjustment, 'action' | 'from' | 'at'> & { rule: string }) | null
}

/**
 * Resolve a kind for a provider the way the session must delegate it: the developer's override, then the
 * clone's automatic move, then the shipped grid; and, within the declared share of the kind's runs, the
 * cheaper tier below it as a trial. Reading never writes: a trial is only counted when its run is recorded.
 */
export function routeKind(state: RoutingState, kind: TaskKind, provider: RoutingProvider, options: { trial?: boolean; now?: Date } = {}): RoutedKind {
  const shared = state.project.routing
  const route = resolveRoute(kind, provider, shared, autoKindsFor(state.local, provider))
  const entry = state.local.kinds[kind]?.[provider]
  const adjustment = route.source === 'auto' && entry ? { action: entry.action, from: entry.from, at: entry.at, rule: entry.evidence.rule } : null
  const offer: TrialOffer | undefined = options.trial === false ? undefined : selectTrial(kind, provider, contextOf(state, options.now))
  if (!offer) return { ...route, trial: false, effectiveTier: null, adjustment }
  const sample = resolveRoute(kind, provider, { ...shared, kinds: { ...shared?.kinds, [kind]: { tier: offer.tier } } })
  return { ...sample, source: route.source, trial: true, effectiveTier: offer.effectiveTier, adjustment }
}

export interface AdjustmentReport extends AdjustOutcome {
  dryRun: boolean
  /** Tier agents whose text differs from what the effective routing would render: refreshed once a move is promoted. */
  staleTierAgents: string[]
}

/**
 * Run the automatic adjustment for the clone of `root`: read the ledger, decide, and write the moves to
 * the local layer under its lock. `dryRun` decides without writing. Does nothing outside a Git checkout.
 */
export async function runAdjustment(root: string, options: { dryRun?: boolean; now?: Date } = {}): Promise<AdjustmentReport> {
  const state = await loadRoutingState(root)
  const now = options.now ?? new Date()
  if (!state.dir) return { decisions: [], local: state.local, moved: false, dryRun: options.dryRun === true, staleTierAgents: [] }
  const stale = (local: LocalRouting) => staleTierAgentPaths(state.project.agents, state.project.routing, local)
  if (options.dryRun) {
    const outcome = adjustRouting(contextOf(state, now))
    return { ...outcome, dryRun: true, staleTierAgents: stale(outcome.local) }
  }
  // The ledger was read before the lock: a run appended meanwhile is evaluated by the next capture.
  const outcome = await updateLocalRouting(state.dir, (local) => {
    const result = adjustRouting({ ...contextOf(state, now), local })
    return { next: result.moved ? result.local : undefined, result }
  })
  return { ...outcome, dryRun: false, staleTierAgents: stale(outcome.local) }
}
