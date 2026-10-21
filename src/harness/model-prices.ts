import priceData from './model-prices.json'
import { ExactRational, exactCostEvidence } from '../execution/exact-cost'

/**
 * What a delegated run cost (#1035). The routing grid carries a cost per task from public benchmarks;
 * the ledger needs a cost per run, which is tokens times a price. The shipped catalogue lists the
 * models whose price is public and dated; any other model is **unpriced** (its cost is `null`, never
 * a guess) until the project declares a price in `modules.harness.routing.adjust.prices`.
 *
 * Money is exact: prices are decimal strings and the amount goes through `ExactRational`, so a float
 * never touches a cost. A price is always above zero: a model that costs nothing is not a price.
 */
export interface PriceRates {
  /** USD per million tokens, decimal strings above zero. */
  input: string
  output: string
  /** Defaults to a tenth of the input price (the documented read multiplier of the prompt cache). */
  cacheRead?: string
  /** Defaults to 1.25 times the input price (the documented 5-minute write multiplier). */
  cacheWrite?: string
}

export interface ModelPrice extends PriceRates {
  /**
   * A model that charges more for a long prompt (Haiku 5.5 above 100K tokens). It is applied per API call,
   * by the size of that call's own prompt (input, cache read and cache write tokens): a run's tokens summed
   * together would hide which calls were long, so a run without its calls cannot be priced and is partial.
   */
  longPrompt?: PriceRates & { abovePromptTokens: number }
}

export interface CataloguedModelPrice extends ModelPrice {
  source: string
  url: string
  date: string
  note: string
}

export interface ModelPriceCatalogue {
  catalogueVersion: 1
  updated: string
  currency: string
  per: number
  models: Record<string, CataloguedModelPrice>
}

export interface TokenUsage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export interface PricedCost {
  /** Decimal USD amount, rounded up once at 1e-8. */
  amount: string
  currency: string
}

export interface CostResult {
  cost: PricedCost | null
  /** The model is priced but this run cannot be (its long-prompt rate needs the usage of each call). */
  partial: boolean
}

const POSITIVE_DECIMAL = /^(?:[1-9]\d*(?:\.\d+)?|0\.\d*[1-9]\d*)$/
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const READ_MULTIPLIER = new ExactRational(1n, 10n)
const WRITE_MULTIPLIER = new ExactRational(5n, 4n)
const COST_SCALE = 8
const RATE_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite']

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

function rateIssues(value: Record<string, unknown>, label: string, extra: string[] = []): string[] {
  const issues: string[] = []
  for (const key of Object.keys(value)) if (![...RATE_KEYS, ...extra].includes(key)) issues.push(`${label}.${key} is not a price field`)
  for (const key of ['input', 'output'] as const) {
    if (typeof value[key] !== 'string' || !POSITIVE_DECIMAL.test(value[key])) issues.push(`${label}.${key} must be a decimal string above zero (USD per million tokens)`)
  }
  for (const key of ['cacheRead', 'cacheWrite'] as const) {
    if (value[key] !== undefined && (typeof value[key] !== 'string' || !POSITIVE_DECIMAL.test(value[key]))) issues.push(`${label}.${key} must be a decimal string above zero when present`)
  }
  return issues
}

/** Issues of a price block, whether shipped or declared by the project; empty when valid. */
export function modelPriceIssues(value: unknown, label: string, catalogued = false): string[] {
  if (!isObject(value)) return [`${label} must be an object`]
  const { longPrompt, ...rates } = value
  const issues = rateIssues(rates, label, ['longPrompt', ...(catalogued ? ['source', 'url', 'date', 'note'] : [])])
  if (longPrompt !== undefined) {
    if (!isObject(longPrompt)) issues.push(`${label}.longPrompt must be an object`)
    else {
      issues.push(...rateIssues(longPrompt, `${label}.longPrompt`, ['abovePromptTokens']))
      if (typeof longPrompt.abovePromptTokens !== 'number' || !Number.isSafeInteger(longPrompt.abovePromptTokens) || longPrompt.abovePromptTokens < 1)
        issues.push(`${label}.longPrompt.abovePromptTokens must be a positive integer`)
    }
  }
  if (catalogued) {
    for (const key of ['source', 'note'] as const) if (typeof value[key] !== 'string' || !value[key].trim()) issues.push(`${label}.${key} must say where the price comes from`)
    if (typeof value.url !== 'string' || !value.url.startsWith('https://')) issues.push(`${label}.url must be an https URL`)
    if (typeof value.date !== 'string' || !DATE.test(value.date)) issues.push(`${label}.date must be YYYY-MM-DD`)
  }
  return issues
}

/** Issues of the project's `adjust.prices` block. */
export function priceOverrideIssues(value: unknown, label = 'routing.adjust.prices'): string[] {
  if (value === undefined) return []
  if (!isObject(value)) return [`${label} must be an object keyed by model identifier`]
  const issues: string[] = []
  for (const [model, price] of Object.entries(value)) {
    if (!MODEL_ID.test(model)) issues.push(`${label}.${model} is not a model identifier`)
    issues.push(...modelPriceIssues(price, `${label}.${model}`))
  }
  return issues
}

function validateCatalogue(value: unknown): asserts value is ModelPriceCatalogue {
  const issues: string[] = []
  if (
    !isObject(value) ||
    value.catalogueVersion !== 1 ||
    value.currency !== 'USD' ||
    value.per !== 1_000_000 ||
    typeof value.updated !== 'string' ||
    !DATE.test(value.updated) ||
    !isObject(value.models)
  ) {
    throw new Error('Invalid model price catalogue: expected catalogueVersion 1, USD per million tokens, an updated date and models.')
  }
  for (const [model, price] of Object.entries(value.models)) {
    if (!MODEL_ID.test(model)) issues.push(`models.${model} is not a model identifier`)
    issues.push(...modelPriceIssues(price, `models.${model}`, true))
  }
  if (issues.length) throw new Error(`Invalid model price catalogue:\n- ${issues.join('\n- ')}`)
}

validateCatalogue(priceData)
const catalogue: ModelPriceCatalogue = JSON.parse(JSON.stringify(priceData))

/** A deep copy of the shipped catalogue, for display and tests. */
export function getModelPriceCatalogue(): ModelPriceCatalogue {
  return JSON.parse(JSON.stringify(catalogue))
}

const has = (table: object, key: string): boolean => Object.prototype.hasOwnProperty.call(table, key)

/**
 * The project's declared price wins over the shipped one; undefined when the model is unpriced. A host
 * may report a dated snapshot of a priced model (`claude-opus-5-5-20261001`): the date does not change the price.
 */
export function resolveModelPrice(model: string | null | undefined, overrides?: Record<string, ModelPrice>): ModelPrice | undefined {
  if (!model) return undefined
  for (const key of [model, model.replace(/[-@]\d{8}$/, '')]) {
    if (overrides && has(overrides, key)) return overrides[key]
    if (has(catalogue.models, key)) return catalogue.models[key]
  }
  return undefined
}

function usageCost(tokens: TokenUsage, rates: PriceRates): ExactRational {
  const input = ExactRational.decimal(rates.input)
  const lines = [
    [tokens.input, input],
    [tokens.output, ExactRational.decimal(rates.output)],
    [tokens.cacheRead, rates.cacheRead !== undefined ? ExactRational.decimal(rates.cacheRead) : input.multiply(READ_MULTIPLIER)],
    [tokens.cacheWrite, rates.cacheWrite !== undefined ? ExactRational.decimal(rates.cacheWrite) : input.multiply(WRITE_MULTIPLIER)]
  ] as const
  let total = new ExactRational(0n)
  for (const [count, rate] of lines) total = total.add(rate.multiply(new ExactRational(BigInt(count))).divide(BigInt(catalogue.per)))
  return total
}

const promptTokens = (call: TokenUsage): number => call.input + call.cacheRead + call.cacheWrite
const money = (total: ExactRational): PricedCost => ({ amount: exactCostEvidence(total, catalogue.currency, COST_SCALE).amount, currency: catalogue.currency })

/**
 * Exact cost of one run. A model with one rate is priced from the run's token totals. A model with a
 * long-prompt rate is priced call by call, each by the size of its own prompt; without the calls it is
 * `partial`: the run keeps its tokens and has no cost, so no comparison rests on a price that could be low.
 */
export function costOfUsage(model: string | null | undefined, usage: { tokens: TokenUsage | null; calls?: readonly TokenUsage[] | null }, overrides?: Record<string, ModelPrice>): CostResult {
  const price = resolveModelPrice(model, overrides)
  if (!price || !usage.tokens) return { cost: null, partial: false }
  if (!price.longPrompt) return { cost: money(usageCost(usage.tokens, price)), partial: false }
  if (!usage.calls?.length) return { cost: null, partial: true }
  let total = new ExactRational(0n)
  for (const call of usage.calls) total = total.add(usageCost(call, promptTokens(call) > price.longPrompt.abovePromptTokens ? price.longPrompt : price))
  return { cost: money(total), partial: false }
}

/** Exact cost of a run priced from its totals: the models with one rate. Null for an unpriced model or one that needs its calls. */
export function costOfTokens(model: string | null | undefined, tokens: TokenUsage | null, overrides?: Record<string, ModelPrice>): PricedCost | null {
  return costOfUsage(model, { tokens }, overrides).cost
}
