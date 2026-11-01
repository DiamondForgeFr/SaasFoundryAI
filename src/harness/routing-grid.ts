import { adjustConfigIssues, type RoutingAdjustConfig } from './routing-adjust-config'
import gridData from './routing-grid.json'
import { createExecutionCandidateId } from '../execution/catalogue'
import type { NormalizedEffort } from '../execution/types'

/** The delegated task kinds of FR-AEX-008, in display order. */
export const TASK_KINDS = ['exploration', 'scoped-edit', 'bug-fix', 'multi-file-feature', 'tests', 'review', 'planning', 'terminal-ci', 'prose'] as const
export type TaskKind = (typeof TASK_KINDS)[number]

/** Coding agents the grid has candidates for; other declared agents get no route. */
export const ROUTING_PROVIDERS = ['claude-code', 'codex'] as const
export type RoutingProvider = (typeof ROUTING_PROVIDERS)[number]

export const ROUTING_EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const
export type RoutingEffort = (typeof ROUTING_EFFORTS)[number] & NormalizedEffort

/**
 * The efforts each host can write in a subagent file (#929): Claude Code's `effort` frontmatter has no
 * `minimal` or `ultra`, Codex's `model_reasoning_effort` has no `minimal` on current models.
 */
export const PROVIDER_EFFORTS: Readonly<Record<RoutingProvider, readonly RoutingEffort[]>> = {
  'claude-code': ['low', 'medium', 'high', 'xhigh', 'max'],
  codex: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']
}

export interface RoutingCandidate {
  model: string
  effort: RoutingEffort
}

export interface RoutingEvidence {
  /** `measured` carries a score and a cost per task; `provisional` names the nearest proxy and waits for the replay bench. */
  status: 'measured' | 'provisional'
  source: string
  url: string
  date: string
  score: number | null
  /** Decimal USD amount, kept as a string so it never passes through a float. */
  costPerTaskUsd: string | null
  note: string
}

export interface RoutingExclusion {
  provider: RoutingProvider
  model: string
  /** Omitted: every effort of the model is excluded. */
  efforts?: RoutingEffort[]
}

export interface RoutingKindEntry {
  tier: string
  excluded: RoutingExclusion[]
  evidence: Record<RoutingProvider, RoutingEvidence>
}

export interface RoutingGrid {
  gridVersion: 1
  updated: string
  rule: string
  providers: Record<RoutingProvider, { vendor: string }>
  tiers: Record<string, Record<RoutingProvider, RoutingCandidate>>
  kinds: Record<TaskKind, RoutingKindEntry>
}

/**
 * `.saasfoundry.json` → `modules.harness.routing`: a project replaces a kind's tier or a tier's
 * candidate, and tunes the automatic adjustment (`adjust`, #1035).
 */
export interface RoutingOverrides {
  kinds?: Partial<Record<TaskKind, { tier: string }>>
  tiers?: Record<string, Partial<Record<RoutingProvider, RoutingCandidate>>>
  adjust?: RoutingAdjustConfig
}

export interface ResolvedRoute {
  kind: TaskKind
  provider: RoutingProvider
  tier: string
  candidate: RoutingCandidate & { id: string }
  /**
   * `project` as soon as the manifest changed the kind's tier or the tier's candidate for this provider;
   * `auto` when only the clone's own automatic adjustment (#1035) moved the kind.
   */
  source: 'shipped' | 'project' | 'auto'
  /** The shipped evidence when the resolved candidate is the shipped one; null for a project choice. */
  evidence: RoutingEvidence | null
  /** True when the candidate is on the kind's exclusion list (scores collapse there); reported, not enforced. */
  excluded: boolean
}

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const exactKeys = (value: Record<string, unknown>, required: string[], optional: string[] = []): boolean =>
  required.every((key) => Object.prototype.hasOwnProperty.call(value, key)) && Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]*$/i
const TIER_ID = /^[a-z][a-z0-9-]*$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const DECIMAL = /^\d+(?:\.\d+)?$/

function isTaskKind(value: unknown): value is TaskKind {
  return typeof value === 'string' && (TASK_KINDS as readonly string[]).includes(value)
}

function isProvider(value: unknown): value is RoutingProvider {
  return typeof value === 'string' && (ROUTING_PROVIDERS as readonly string[]).includes(value)
}

function candidateIssue(value: unknown, label: string, provider: RoutingProvider): string | undefined {
  if (!object(value) || !exactKeys(value, ['model', 'effort'])) return `${label} must be { model, effort }`
  if (typeof value.model !== 'string' || !SAFE_ID.test(value.model)) return `${label}.model must be a model identifier`
  if (typeof value.effort !== 'string' || !(ROUTING_EFFORTS as readonly string[]).includes(value.effort)) return `${label}.effort must be one of ${ROUTING_EFFORTS.join(', ')}`
  // A tier agent must be able to carry the effort, otherwise the host would silently run another one.
  if (!(PROVIDER_EFFORTS[provider] as readonly string[]).includes(value.effort))
    return `${label}.effort '${value.effort}' cannot be expressed by ${provider} (${PROVIDER_EFFORTS[provider].join(', ')})`
  return undefined
}

function evidenceIssue(value: unknown, label: string): string | undefined {
  if (!object(value) || !exactKeys(value, ['status', 'source', 'url', 'date', 'score', 'costPerTaskUsd', 'note']))
    return `${label} must declare status, source, url, date, score, costPerTaskUsd and note`
  if (value.status !== 'measured' && value.status !== 'provisional') return `${label}.status must be measured or provisional`
  if (typeof value.source !== 'string' || !value.source.trim() || typeof value.note !== 'string' || !value.note.trim()) return `${label} needs a source and a note`
  let url: URL
  try {
    url = new URL(String(value.url))
  } catch {
    return `${label}.url must be a URL`
  }
  if (url.protocol !== 'https:' || url.username || url.password) return `${label}.url must be a plain https URL`
  if (typeof value.date !== 'string' || !DATE.test(value.date)) return `${label}.date must be YYYY-MM-DD`
  if (value.status === 'measured') {
    if (typeof value.score !== 'number' || !Number.isFinite(value.score) || value.score < 0) return `${label}: a measured entry needs a score`
    if (typeof value.costPerTaskUsd !== 'string' || !DECIMAL.test(value.costPerTaskUsd)) return `${label}: a measured entry needs a decimal costPerTaskUsd`
  } else if (value.score !== null || value.costPerTaskUsd !== null) {
    // A provisional entry never claims a measurement it does not have.
    return `${label}: a provisional entry has no score and no cost`
  }
  return undefined
}

function excludedBy(exclusions: readonly RoutingExclusion[], provider: RoutingProvider, candidate: RoutingCandidate): boolean {
  return exclusions.some((rule) => rule.provider === provider && rule.model === candidate.model && (!rule.efforts || rule.efforts.includes(candidate.effort)))
}

/** Validate the bundled grid: closed keys, every kind and provider covered, evidence for every entry. */
export function validateRoutingGrid(value: unknown): asserts value is RoutingGrid {
  const issues: string[] = []
  if (!object(value) || value.gridVersion !== 1 || !exactKeys(value, ['gridVersion', 'updated', 'rule', 'providers', 'tiers', 'kinds'])) {
    throw new Error('Invalid routing grid: expected gridVersion 1 with updated, rule, providers, tiers and kinds.')
  }
  if (typeof value.updated !== 'string' || !DATE.test(value.updated)) issues.push('updated must be YYYY-MM-DD')
  if (typeof value.rule !== 'string' || !value.rule.trim()) issues.push('rule must describe the seeding rule')
  if (!object(value.providers) || !exactKeys(value.providers, [...ROUTING_PROVIDERS])) issues.push(`providers must be exactly ${ROUTING_PROVIDERS.join(', ')}`)
  else
    for (const provider of ROUTING_PROVIDERS) {
      const entry = value.providers[provider]
      if (!object(entry) || !exactKeys(entry, ['vendor']) || typeof entry.vendor !== 'string' || !SAFE_ID.test(entry.vendor)) issues.push(`providers.${provider}.vendor must be an identifier`)
    }
  const tiers = object(value.tiers) ? value.tiers : {}
  if (!object(value.tiers) || Object.keys(tiers).length === 0) issues.push('tiers must not be empty')
  for (const [tier, candidates] of Object.entries(tiers)) {
    if (!TIER_ID.test(tier)) issues.push(`tier '${tier}' must be a lowercase identifier`)
    if (!object(candidates) || !exactKeys(candidates, [...ROUTING_PROVIDERS])) {
      issues.push(`tiers.${tier} must name a candidate for each of ${ROUTING_PROVIDERS.join(', ')}`)
      continue
    }
    for (const provider of ROUTING_PROVIDERS) {
      const issue = candidateIssue(candidates[provider], `tiers.${tier}.${provider}`, provider)
      if (issue) issues.push(issue)
    }
  }
  if (!object(value.kinds) || !exactKeys(value.kinds, [...TASK_KINDS])) issues.push(`kinds must be exactly ${TASK_KINDS.join(', ')}`)
  else
    for (const kind of TASK_KINDS) {
      const entry = value.kinds[kind]
      const label = `kinds.${kind}`
      if (!object(entry) || !exactKeys(entry, ['tier', 'excluded', 'evidence'])) {
        issues.push(`${label} must declare tier, excluded and evidence`)
        continue
      }
      if (typeof entry.tier !== 'string' || !object(tiers[entry.tier])) issues.push(`${label}.tier must name a declared tier`)
      if (!Array.isArray(entry.excluded)) issues.push(`${label}.excluded must be a list`)
      else
        for (const [index, rule] of entry.excluded.entries()) {
          const ok =
            object(rule) &&
            exactKeys(rule, ['provider', 'model'], ['efforts']) &&
            isProvider(rule.provider) &&
            typeof rule.model === 'string' &&
            SAFE_ID.test(rule.model) &&
            (rule.efforts === undefined || (Array.isArray(rule.efforts) && rule.efforts.length > 0 && rule.efforts.every((effort) => (ROUTING_EFFORTS as readonly unknown[]).includes(effort))))
          if (!ok) issues.push(`${label}.excluded[${index}] must be { provider, model, efforts? }`)
        }
      if (!object(entry.evidence) || !exactKeys(entry.evidence, [...ROUTING_PROVIDERS])) {
        issues.push(`${label}.evidence must cover ${ROUTING_PROVIDERS.join(', ')}`)
        continue
      }
      for (const provider of ROUTING_PROVIDERS) {
        const issue = evidenceIssue(entry.evidence[provider], `${label}.evidence.${provider}`)
        if (issue) issues.push(issue)
      }
    }
  if (issues.length) throw new Error(`Invalid routing grid:\n- ${issues.join('\n- ')}`)
  // The shipped seeds must respect their own exclusions; an override may not, and is reported.
  for (const kind of TASK_KINDS) {
    const entry = (value as unknown as RoutingGrid).kinds[kind]
    for (const provider of ROUTING_PROVIDERS) {
      if (excludedBy(entry.excluded, provider, (value as unknown as RoutingGrid).tiers[entry.tier][provider])) issues.push(`kinds.${kind} seeds an excluded ${provider} candidate`)
    }
  }
  if (issues.length) throw new Error(`Invalid routing grid:\n- ${issues.join('\n- ')}`)
}

/** Validate `modules.harness.routing`; returns the issues instead of throwing so callers can name the manifest. */
export function routingOverrideIssues(value: unknown, grid: RoutingGrid = shippedGrid): string[] {
  if (value === undefined) return []
  if (!object(value) || !exactKeys(value, [], ['kinds', 'tiers', 'adjust'])) return ['routing must be an object with optional kinds, tiers and adjust']
  const issues: string[] = [...adjustConfigIssues(value.adjust)]
  const projectTiers = object(value.tiers) ? value.tiers : {}
  if (value.tiers !== undefined && !object(value.tiers)) issues.push('routing.tiers must be an object')
  for (const [tier, candidates] of Object.entries(projectTiers)) {
    if (!TIER_ID.test(tier)) issues.push(`routing.tiers.${tier} must be a lowercase identifier`)
    if (!object(candidates) || Object.keys(candidates).length === 0 || !Object.keys(candidates).every(isProvider)) {
      issues.push(`routing.tiers.${tier} must name candidates for ${ROUTING_PROVIDERS.join(' or ')}`)
      continue
    }
    for (const [provider, candidate] of Object.entries(candidates)) {
      const issue = candidateIssue(candidate, `routing.tiers.${tier}.${provider}`, provider as RoutingProvider)
      if (issue) issues.push(issue)
    }
  }
  if (value.kinds !== undefined && !object(value.kinds)) issues.push('routing.kinds must be an object')
  for (const [kind, entry] of Object.entries(object(value.kinds) ? value.kinds : {})) {
    if (!isTaskKind(kind)) {
      issues.push(`routing.kinds.${kind} is not a task kind (${TASK_KINDS.join(', ')})`)
      continue
    }
    if (!object(entry) || !exactKeys(entry, ['tier']) || typeof entry.tier !== 'string') {
      issues.push(`routing.kinds.${kind} must be { tier }`)
      continue
    }
    const tier = entry.tier
    // A tier the project introduces must cover every provider it is resolved for.
    if (!Object.prototype.hasOwnProperty.call(grid.tiers, tier) && !object(projectTiers[tier])) issues.push(`routing.kinds.${kind}.tier '${tier}' is neither shipped nor declared in routing.tiers`)
  }
  return issues
}

validateRoutingGrid(gridData)
// Freeze an independent snapshot so mutations of the imported JSON cannot change routing.
const shippedGrid: RoutingGrid = JSON.parse(JSON.stringify(gridData))
const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}
deepFreeze(shippedGrid)

export const ROUTING_GRID_VERSION = shippedGrid.gridVersion

/**
 * The shipped tiers from the lightest to the strongest: the order the grid declares them in is the
 * ladder an automatic adjustment climbs or descends (#1035). A tier a project declares is not on it.
 */
export const TIER_LADDER: readonly string[] = Object.freeze(Object.keys(shippedGrid.tiers))

/** Position of a shipped tier on the ladder; -1 for a tier the project introduced. */
export function tierRank(tier: string): number {
  return TIER_LADDER.indexOf(tier)
}

/** A deep copy of the shipped grid, for display. */
export function getRoutingGrid(): RoutingGrid {
  return JSON.parse(JSON.stringify(shippedGrid))
}

export function isRoutingProvider(value: unknown): value is RoutingProvider {
  return isProvider(value)
}

export function parseTaskKind(value: unknown): TaskKind {
  if (!isTaskKind(value)) throw new Error(`Unknown task kind '${String(value)}'. Task kinds: ${TASK_KINDS.join(', ')}.`)
  return value
}

/** The candidate a tier runs for a provider: the project's declaration when it made one, otherwise the shipped grid. Undefined for a tier nobody declared. */
export function resolveTierCandidate(tier: string, provider: RoutingProvider, overrides?: RoutingOverrides): RoutingCandidate | undefined {
  const declared = overrides?.tiers && Object.prototype.hasOwnProperty.call(overrides.tiers, tier) ? overrides.tiers[tier]?.[provider] : undefined
  const shipped = Object.prototype.hasOwnProperty.call(shippedGrid.tiers, tier) ? shippedGrid.tiers[tier][provider] : undefined
  const candidate = declared ?? shipped
  return candidate ? { model: candidate.model, effort: candidate.effort } : undefined
}

/** Whether the grid keeps this candidate off a kind (scores collapse there); the automatic adjustment treats it as a floor it never crosses. */
export function isCandidateExcluded(kind: TaskKind, provider: RoutingProvider, candidate: RoutingCandidate): boolean {
  return excludedBy(shippedGrid.kinds[kind].excluded, provider, candidate)
}

/** The tier the automatic adjustment moved a kind to, for one provider (#1035). */
export type AutoKinds = Partial<Record<TaskKind, { tier: string }>>

/**
 * Resolve one kind for one provider. The order is the developer's shared override, then the local
 * automatic move (`auto`, from the clone's own delegation outcomes), then the shipped grid. An automatic
 * move to a tier that no longer exists is ignored, not an error: the grid may have moved on since.
 */
export function resolveRoute(kind: TaskKind, provider: RoutingProvider, overrides?: RoutingOverrides, auto?: AutoKinds): ResolvedRoute {
  const issues = routingOverrideIssues(overrides)
  if (issues.length) throw new Error(`Invalid modules.harness.routing:\n- ${issues.join('\n- ')}`)
  const shipped = shippedGrid.kinds[kind]
  const autoTier = !overrides?.kinds?.[kind] && auto?.[kind] && resolveTierCandidate(auto[kind]!.tier, provider, overrides) ? auto[kind]!.tier : undefined
  const tier = overrides?.kinds?.[kind]?.tier ?? autoTier ?? shipped.tier
  const projectCandidate = overrides?.tiers?.[tier]?.[provider]
  const shippedCandidate = shippedGrid.tiers[tier]?.[provider]
  const candidate = projectCandidate ?? shippedCandidate
  if (!candidate) throw new Error(`Tier '${tier}' has no ${provider} candidate: declare routing.tiers.${tier}.${provider} in .saasfoundry.json.`)
  const shippedSeed = shippedGrid.tiers[shipped.tier][provider]
  const isShippedSeed = candidate.model === shippedSeed.model && candidate.effort === shippedSeed.effort
  const source = projectCandidate !== undefined || (tier !== shipped.tier && autoTier === undefined) ? 'project' : tier !== shipped.tier ? 'auto' : 'shipped'
  return {
    kind,
    provider,
    tier,
    candidate: { id: createExecutionCandidateId(shippedGrid.providers[provider].vendor, provider, candidate.model, candidate.effort), model: candidate.model, effort: candidate.effort },
    source,
    evidence: isShippedSeed ? { ...shipped.evidence[provider] } : null,
    excluded: excludedBy(shipped.excluded, provider, candidate)
  }
}

export interface TierAssignment {
  tier: string
  provider: RoutingProvider
  candidate: ResolvedRoute['candidate']
  /** `project` when the manifest declares this tier's candidate for the provider, or the tier itself. */
  source: 'shipped' | 'project'
  /** The kinds routed to this tier, in display order. */
  kinds: TaskKind[]
  /** Every other kind with the tier it goes to, so a tier agent can say when not to use it. */
  elsewhere: { kind: TaskKind; tier: string }[]
  /** The kinds whose exclusion list names this tier's candidate; reported, not enforced. */
  excludedFor: TaskKind[]
}

/** Group the resolved routes of one provider by tier: one entry per tier that serves at least one kind. */
export function listTierAssignments(provider: RoutingProvider, overrides?: RoutingOverrides, auto?: AutoKinds): TierAssignment[] {
  const routes = TASK_KINDS.map((kind) => resolveRoute(kind, provider, overrides, auto))
  const order = [...Object.keys(shippedGrid.tiers), ...Object.keys(overrides?.tiers ?? {})]
  const tiers = [...new Set(order)].filter((tier) => routes.some((route) => route.tier === tier))
  return tiers.map((tier) => {
    const served = routes.filter((route) => route.tier === tier)
    const shippedTier = Object.prototype.hasOwnProperty.call(shippedGrid.tiers, tier)
    return {
      tier,
      provider,
      candidate: served[0].candidate,
      source: !shippedTier || overrides?.tiers?.[tier]?.[provider] !== undefined ? 'project' : 'shipped',
      kinds: served.map((route) => route.kind),
      elsewhere: routes.filter((route) => route.tier !== tier).map((route) => ({ kind: route.kind, tier: route.tier })),
      excludedFor: served.filter((route) => route.excluded).map((route) => route.kind)
    }
  })
}
