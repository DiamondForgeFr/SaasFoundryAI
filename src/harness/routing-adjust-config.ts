import { priceOverrideIssues, type ModelPrice } from './model-prices'

/**
 * `modules.harness.routing.adjust` (#1035): how the routing moves a task kind from the project's own
 * delegation outcomes. Every field is optional and the shipped defaults apply to omission, so a
 * manifest written before the block existed keeps validating and needs no migration (optional field,
 * `language` precedent in .claude/docs/migration-framework.md).
 */
export interface RoutingAdjustConfig {
  /** `false` switches the automatic adjustment off: outcomes are still recorded. Default true. */
  enabled?: boolean
  /** How many of the latest rated runs of a candidate count. Default 20. */
  window?: number
  /** Move a kind up one tier after `failures` failures among its last `of` rated runs. Default 3 of 10. */
  escalate?: { failures: number; of: number }
  /** Move a kind down one tier once the cheaper tier has `successes` trial successes and at most `failures` failures. Default 8 and 0. */
  deescalate?: { successes: number; failures: number }
  /** The share of a kind's runs that may try the cheaper tier. Default 0.1. */
  trialShare?: number
  /** Days the cheaper tier is left alone after a trial failed. Default 14. */
  trialCooldownDays?: number
  /** Two tiers whose expected feature cost differs by less than this fraction tie, and duration decides. Default 0.1. */
  costBand?: number
  /** A tier whose p95 duration exceeds this many milliseconds is not chosen. No ceiling by default. */
  maxDurationMs?: number
  /** USD per million tokens, for a model the shipped price catalogue does not list. */
  prices?: Record<string, ModelPrice>
}

export interface AdjustPolicy {
  enabled: boolean
  window: number
  escalateFailures: number
  escalateOf: number
  deescalateSuccesses: number
  deescalateFailures: number
  trialShare: number
  trialCooldownDays: number
  costBand: number
  maxDurationMs: number | null
  prices: Record<string, ModelPrice>
}

export const DEFAULT_ADJUST_POLICY: Readonly<AdjustPolicy> = Object.freeze({
  enabled: true,
  window: 20,
  escalateFailures: 3,
  escalateOf: 10,
  deescalateSuccesses: 8,
  deescalateFailures: 0,
  trialShare: 0.1,
  trialCooldownDays: 14,
  costBand: 0.1,
  maxDurationMs: null,
  prices: Object.freeze({}) as Record<string, ModelPrice>
})

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const integer = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
const fraction = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max

function pairIssues(value: unknown, label: string, keys: [string, number, number][]): string[] {
  if (!object(value)) return [`${label} must be an object`]
  const issues: string[] = []
  for (const key of Object.keys(value)) if (!keys.some(([name]) => name === key)) issues.push(`${label}.${key} is not a field`)
  for (const [name, min, max] of keys) if (!integer(value[name], min, max)) issues.push(`${label}.${name} must be an integer from ${min} to ${max}`)
  return issues
}

/** Issues of the block as written in the manifest; empty when valid or absent. */
export function adjustConfigIssues(value: unknown, label = 'routing.adjust'): string[] {
  if (value === undefined) return []
  if (!object(value)) return [`${label} must be an object`]
  const issues: string[] = []
  const known = ['enabled', 'window', 'escalate', 'deescalate', 'trialShare', 'trialCooldownDays', 'costBand', 'maxDurationMs', 'prices']
  for (const key of Object.keys(value)) if (!known.includes(key)) issues.push(`${label}.${key} is not an adjustment setting (${known.join(', ')})`)
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') issues.push(`${label}.enabled must be a boolean`)
  if (value.window !== undefined && !integer(value.window, 5, 500)) issues.push(`${label}.window must be an integer from 5 to 500`)
  if (value.escalate !== undefined) {
    issues.push(
      ...pairIssues(value.escalate, `${label}.escalate`, [
        ['failures', 1, 500],
        ['of', 2, 500]
      ])
    )
    if (object(value.escalate) && integer(value.escalate.failures, 1, 500) && integer(value.escalate.of, 2, 500)) {
      if (value.escalate.failures > value.escalate.of) issues.push(`${label}.escalate.failures cannot exceed escalate.of`)
      const window = value.window === undefined ? DEFAULT_ADJUST_POLICY.window : value.window
      if (typeof window === 'number' && value.escalate.of > window) issues.push(`${label}.escalate.of cannot exceed the window`)
    }
  }
  if (value.deescalate !== undefined)
    issues.push(
      ...pairIssues(value.deescalate, `${label}.deescalate`, [
        ['successes', 1, 500],
        ['failures', 0, 500]
      ])
    )
  if (value.trialShare !== undefined && !fraction(value.trialShare, 0.01, 0.5)) issues.push(`${label}.trialShare must be a share from 0.01 to 0.5 of the runs`)
  if (value.trialCooldownDays !== undefined && !integer(value.trialCooldownDays, 0, 365)) issues.push(`${label}.trialCooldownDays must be an integer from 0 to 365`)
  if (value.costBand !== undefined && !fraction(value.costBand, 0, 0.5)) issues.push(`${label}.costBand must be a fraction from 0 to 0.5`)
  if (value.maxDurationMs !== undefined && !integer(value.maxDurationMs, 1000, 7 * 24 * 60 * 60 * 1000)) issues.push(`${label}.maxDurationMs must be a duration from 1000 ms to a week`)
  issues.push(...priceOverrideIssues(value.prices, `${label}.prices`))
  return issues
}

/** The effective policy: the declared settings over the shipped defaults. Validate with `adjustConfigIssues` first. */
export function resolveAdjustPolicy(config?: RoutingAdjustConfig): AdjustPolicy {
  const defaults = DEFAULT_ADJUST_POLICY
  return {
    enabled: config?.enabled ?? defaults.enabled,
    window: config?.window ?? defaults.window,
    escalateFailures: config?.escalate?.failures ?? defaults.escalateFailures,
    escalateOf: config?.escalate?.of ?? defaults.escalateOf,
    deescalateSuccesses: config?.deescalate?.successes ?? defaults.deescalateSuccesses,
    deescalateFailures: config?.deescalate?.failures ?? defaults.deescalateFailures,
    trialShare: config?.trialShare ?? defaults.trialShare,
    trialCooldownDays: config?.trialCooldownDays ?? defaults.trialCooldownDays,
    costBand: config?.costBand ?? defaults.costBand,
    maxDurationMs: config?.maxDurationMs ?? defaults.maxDurationMs,
    prices: { ...(config?.prices ?? {}) }
  }
}
