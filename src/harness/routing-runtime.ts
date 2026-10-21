import { buildRouteRecord, readLedger, resolveLedgerDir, transact, type Complexity, type LedgerState, type Nature } from './delegation-ledger'
import { readProjectRouting, type ProjectRouting } from './project-routing'
import { adjustRouting, selectTrial, type AdjustContext, type AdjustOutcome, type TrialOffer } from './routing-adjust'
import { autoKindsFor, emptyLocalRouting, readLocalRouting, staleTierAgentPaths, updateLocalRouting, withLogEntry, type LocalAdjustment, type LocalRouting } from './routing-local'
import { resolveRoute, ROUTING_PROVIDERS, type ResolvedRoute, type RoutingProvider, type TaskKind } from './routing-grid'

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

const emptyLedger = (): LedgerState => ({ runs: [], routes: [], statuses: [], skipped: 0, unmatchedSignals: 0 })

export interface LoadOptions {
  project?: ProjectRouting
  /** The clone-private directory when the caller already resolved it (`undefined`: known to be outside a Git checkout). */
  dir?: string | undefined
  /** The folded ledger when the caller just wrote to it and has it: read nothing again. */
  ledger?: LedgerState
  onDamaged?: (message: string) => void
}

/**
 * Read the routing state of the clone of `root`. The project's own routing fails closed (an unreadable
 * manifest or an invalid block is an error). A damaged ledger or local layer is an error too, unless the
 * caller can live without them (`onDamaged`): `sf agents route` must keep answering from the shared
 * routing, saying what it could not read.
 */
export async function loadRoutingState(root: string, options: LoadOptions = {}): Promise<RoutingState> {
  const project = options.project ?? (await readProjectRouting(root))
  const dir = 'dir' in options ? options.dir : await resolveLedgerDir(root)
  if (!dir) return { root, dir, project, ledger: emptyLedger(), local: emptyLocalRouting() }
  try {
    return { root, dir, project, ledger: options.ledger ?? (await readLedger(dir)), local: await readLocalRouting(dir) }
  } catch (error) {
    if (!options.onDamaged) throw error
    options.onDamaged(error instanceof Error ? error.message : String(error))
    return { root, dir, project, ledger: emptyLedger(), local: emptyLocalRouting() }
  }
}

/** The context a decision is taken in: the policy and the overrides of the committed working branch, never the worktree's own. */
export const contextOf = (state: RoutingState, now: Date = new Date()): AdjustContext => ({
  shared: state.project.decision.routing,
  local: state.local,
  policy: state.project.decision.policy,
  runs: state.ledger.runs,
  routes: state.ledger.routes,
  now
})

export interface RoutedKind extends ResolvedRoute {
  /** The route is a sample of another rung than the one the kind is routed to. */
  trial: boolean
  /** With a trial, the tier the kind is routed to. */
  effectiveTier: string | null
  /** The automatic move behind an `auto` route. */
  adjustment: (Pick<LocalAdjustment, 'action' | 'from' | 'at'> & { rule: string }) | null
}

/**
 * Resolve a kind for a provider the way the session must delegate it: the developer's override, then the
 * clone's automatic move, then the shipped grid; and, within the declared share of the kind's runs, the
 * cheaper tier below it (or a new stronger one) as a trial. Reading never writes: a trial is only counted
 * when its route is recorded or its run is.
 *
 * A worktree whose routing block differs from the committed one is routed by its own block for display, and
 * is offered no trial: a trial is evidence, and evidence rests on what the team committed.
 */
export function routeKind(state: RoutingState, kind: TaskKind, provider: RoutingProvider, options: { trial?: boolean; now?: Date } = {}): RoutedKind {
  const shared = state.project.routing
  const route = resolveRoute(kind, provider, shared, autoKindsFor(state.local, provider))
  const entry = state.local.kinds[kind]?.[provider]
  const adjustment = route.source === 'auto' && entry ? { action: entry.action, from: entry.from, at: entry.at, rule: entry.evidence.rule } : null
  const offer: TrialOffer | undefined = options.trial === false || state.project.decision.differs ? undefined : selectTrial(kind, provider, contextOf(state, options.now))
  if (!offer) return { ...route, trial: false, effectiveTier: null, adjustment }
  const sample = resolveRoute(kind, provider, { ...shared, kinds: { ...shared?.kinds, [kind]: { tier: offer.tier } } })
  return { ...sample, source: route.source, trial: true, effectiveTier: offer.effectiveTier, adjustment }
}

export interface RouteRequest {
  /** Issue a route record (an id the delegate echoes, which also reserves a trial). Without it the route is only read. */
  record: boolean
  trial: boolean
  ticket?: number | null
  complexity?: Complexity | null
  nature?: Nature | null
  /** The earlier route or run this one retries on a stronger tier. */
  retryOf?: string | null
  now?: Date
}

export interface IssuedRoute extends RoutedKind {
  /** The id the delegate echoes in its SF-DELEGATION line; null when the route was only read. */
  routeId: string | null
  expiresAt: string | null
}

/**
 * Route a kind for each provider and, when asked, record each route in the ledger under its lock: the
 * trial decision and the reservation are one step, so two routes issued together cannot both take the
 * last place of the trial share. A route record is the only thing that tells a capture which kind, tier,
 * ticket and trial a delegation was, so what a delegate says about itself never has to be believed.
 */
export async function issueRoutes(state: RoutingState, kind: TaskKind, providers: readonly RoutingProvider[], request: RouteRequest): Promise<IssuedRoute[]> {
  const now = request.now ?? new Date()
  if (!request.record) return providers.map((provider) => ({ ...routeKind(state, kind, provider, { trial: request.trial, now }), routeId: null, expiresAt: null }))
  if (!state.dir) throw new Error('A route id is kept in the ledger of the clone: run this from a Git checkout, or read the route without --record.')
  const { result } = await transact(state.dir, ({ state: ledger, append }) => {
    const current: RoutingState = { ...state, ledger }
    if (request.retryOf && !ledger.runs.some((run) => run.id === request.retryOf) && !ledger.routes.some((route) => route.id === request.retryOf)) {
      throw new Error(`--retry-of ${request.retryOf} names no route or run of this clone's ledger.`)
    }
    return providers.map((provider): IssuedRoute => {
      const routed = routeKind(current, kind, provider, { trial: request.trial, now })
      const record = buildRouteRecord({
        taskKind: kind,
        provider,
        tier: routed.tier,
        trial: routed.trial,
        ticket: request.ticket,
        complexity: request.complexity,
        nature: request.nature,
        retryOf: request.retryOf,
        now
      })
      append(record)
      return { ...routed, routeId: record.id, expiresAt: record.expiresAt }
    })
  })
  return result
}

export interface ResetResult {
  kind: TaskKind
  /** The automatic moves that were undone, with the tier the kind is routed to again. */
  reset: { provider: RoutingProvider; from: string; restoredTo: string }[]
  /** The tier the developer's shared override pins the kind to; it is never changed by a reset. */
  sharedOverride: string | null
}

/**
 * Undo the automatic moves of a kind (#1035, AC-6): the kind returns to the shared routing, or to the
 * shipped grid. The evidence restarts from now, so the same runs do not move it again at the next
 * capture. What the developer wrote in the manifest is not an automatic move and stays as it is.
 */
export async function resetLocalRouting(root: string, kind: TaskKind, options: { provider?: RoutingProvider; now?: Date } = {}): Promise<ResetResult> {
  const project = await readProjectRouting(root)
  const dir = await resolveLedgerDir(root)
  if (!dir) throw new Error('The local routing is kept in the Git directory of the clone: run this from a Git checkout.')
  const at = (options.now ?? new Date()).toISOString()
  const sharedOverride = project.routing?.kinds?.[kind]?.tier ?? null
  return updateLocalRouting(dir, (local) => {
    const entries = ROUTING_PROVIDERS.flatMap((provider) =>
      local.kinds[kind]?.[provider] && (!options.provider || options.provider === provider) ? [{ provider, entry: local.kinds[kind]![provider]! }] : []
    )
    if (!entries.length) return { result: { kind, reset: [], sharedOverride } }
    const remaining = { ...local.kinds[kind] }
    const holds = { ...local.holds[kind] }
    let next: LocalRouting = local
    const reset: ResetResult['reset'] = []
    for (const { provider, entry } of entries) {
      delete remaining[provider]
      delete holds[provider]
      const restoredTo = resolveRoute(kind, provider, project.routing).tier
      reset.push({ provider, from: entry.tier, restoredTo })
      next = withLogEntry(next, { at, action: 'reset', kind, provider, from: entry.tier, to: restoredTo, evidence: entry.evidence, note: 'automatic move undone by sf agents routing reset' })
    }
    const kinds = { ...local.kinds, [kind]: remaining }
    if (!Object.keys(remaining).length) delete kinds[kind]
    const allHolds = { ...local.holds, [kind]: holds }
    if (!Object.keys(holds).length) delete allHolds[kind]
    const boundaries = { ...local.boundaries, [kind]: { ...(local.boundaries[kind] ?? {}), ...Object.fromEntries(entries.map(({ provider }) => [provider, at])) } }
    return { next: { ...next, kinds, holds: allHolds, boundaries }, result: { kind, reset, sharedOverride } }
  })
}

export interface AdjustmentReport extends AdjustOutcome {
  dryRun: boolean
  /** Tier agents whose text differs from what the effective routing would render: refreshed once a move is promoted. */
  staleTierAgents: string[]
  /** Why nothing was decided: the routing block of this worktree is not the committed one. */
  refused: string | null
}

/**
 * Run the automatic adjustment for the clone of `root`: read the ledger, decide, and write the decisions to
 * the local layer under its lock. `dryRun` decides without writing. Does nothing outside a Git checkout,
 * and nothing while the worktree's routing block differs from the one committed on the working branch.
 * A caller that just appended to the ledger passes the state it got back, so nothing is folded twice.
 */
export async function runAdjustment(
  root: string,
  options: { dryRun?: boolean; now?: Date; state?: RoutingState; ledger?: LedgerState; dir?: string | undefined; project?: ProjectRouting } = {}
): Promise<AdjustmentReport> {
  const state = options.state ?? (await loadRoutingState(root, { project: options.project, ...('dir' in options ? { dir: options.dir } : {}), ...(options.ledger ? { ledger: options.ledger } : {}) }))
  const now = options.now ?? new Date()
  const none = { decisions: [], local: state.local, moved: false, changed: false, dryRun: options.dryRun === true, staleTierAgents: [] }
  if (!state.dir) return { ...none, refused: null }
  if (state.project.decision.invalid) return { ...none, refused: `${state.project.decision.invalid}: no automatic move is decided until it is fixed.` }
  if (state.project.decision.differs) {
    return {
      ...none,
      refused: `modules.harness.routing of this worktree differs from the one committed on ${state.project.decision.branch}: no automatic move is decided until they match (commit it, or run from a tree that matches).`
    }
  }
  const stale = (local: LocalRouting) => staleTierAgentPaths(state.project.agents, state.project.routing, local)
  if (options.dryRun) {
    const outcome = adjustRouting(contextOf(state, now))
    return { ...outcome, dryRun: true, staleTierAgents: stale(outcome.local), refused: null }
  }
  // The ledger was read before the lock: a run appended meanwhile is evaluated by the next capture.
  const outcome = await updateLocalRouting(state.dir, (local) => {
    const result = adjustRouting({ ...contextOf(state, now), local })
    return { next: result.changed ? result.local : undefined, result }
  })
  return { ...outcome, dryRun: false, staleTierAgents: stale(outcome.local), refused: null }
}
