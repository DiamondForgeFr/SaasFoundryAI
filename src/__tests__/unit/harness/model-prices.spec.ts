import { costOfTokens, costOfUsage, getModelPriceCatalogue, modelPriceIssues, priceOverrideIssues, resolveModelPrice } from '../../../harness/model-prices'
import { getRoutingGrid } from '../../../harness/routing-grid'

const usage = (input: number, output: number, cacheRead = 0, cacheWrite = 0) => ({ input, output, cacheRead, cacheWrite })

describe('model prices (#1035)', () => {
  it('prices every Claude Code model the shipped grid routes to, with a dated source', () => {
    const grid = getRoutingGrid()
    const claudeModels = new Set(Object.values(grid.tiers).map((tier) => tier['claude-code'].model))
    for (const model of claudeModels) {
      const price = getModelPriceCatalogue().models[model]
      expect(price).toBeDefined()
      expect(price.url).toMatch(/^https:\/\//)
      expect(price.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('does not invent a price for a model it has no public source for', () => {
    expect(resolveModelPrice('gpt-6.1-sol')).toBeUndefined()
    expect(costOfTokens('gpt-6.1-sol', usage(1, 1))).toBeNull()
    expect(costOfTokens(null, usage(1, 1))).toBeNull()
  })

  it('lets the project declare the price of a model, which wins over the catalogue', () => {
    expect(resolveModelPrice('claude-opus-5-5', { 'claude-opus-5-5': { input: '1', output: '2' } })).toEqual({ input: '1', output: '2' })
  })

  it('treats a dated snapshot of a priced model as that model', () => {
    expect(costOfTokens('claude-opus-5-5-20261001', usage(1_000_000, 0))).toEqual({ amount: '4.00000000', currency: 'USD' })
  })

  it('derives the cache rates from the input rate when the source does not give them', () => {
    // Sonnet 5.5 declares its cache-read rate ($0.20) and not a cache-write rate: 1.25 times its $2 input
    expect(costOfTokens('claude-sonnet-5-5', usage(0, 0, 0, 1_000_000))).toEqual({ amount: '2.50000000', currency: 'USD' })
    expect(costOfTokens('claude-opus-5-5', usage(0, 0, 1_000_000, 0))).toEqual({ amount: '0.20000000', currency: 'USD' })
    // Haiku 5.5 declares neither: a tenth of its $0.10 input rate to read, 1.25 times it to write
    expect(costOfUsage('claude-haiku-5-5', { tokens: usage(0, 0, 50_000, 50_000), calls: [usage(0, 0, 50_000, 50_000)] }).cost).toEqual({ amount: '0.00675000', currency: 'USD' })
  })

  it('rounds up once at 1e-8 and never goes through a float', () => {
    const one = (call: ReturnType<typeof usage>) => costOfUsage('claude-haiku-5-5', { tokens: call, calls: [call] }).cost
    expect(one(usage(1, 0))).toEqual({ amount: '0.00000010', currency: 'USD' })
    expect(one(usage(0, 3))).toEqual({ amount: '0.00000150', currency: 'USD' })
  })

  describe('a model that charges more for a long prompt', () => {
    it('prices each call by the size of its own prompt: input, cache read and cache write together, strictly over the threshold', () => {
      const atThreshold = usage(60_000, 1_000, 30_000, 10_000)
      const over = usage(60_000, 1_000, 30_000, 10_001)
      const rate = (call: ReturnType<typeof usage>) => costOfUsage('claude-haiku-5-5', { tokens: call, calls: [call] }).cost?.amount
      expect(rate(atThreshold)).toBe('0.00805000')
      // The same call one token longer is priced at the long-prompt rates: input 0.50, output 2.50, cache read 0.05, cache write 0.625
      expect(rate(over)).toBe('0.04025063')
    })

    it('cannot price a run it only has the totals of: partial, no cost, never a number that could be low', () => {
      expect(costOfUsage('claude-haiku-5-5', { tokens: usage(500_000, 1_000) })).toEqual({ cost: null, partial: true })
      expect(costOfTokens('claude-haiku-5-5', usage(500_000, 1_000))).toBeNull()
    })

    it('leaves a model with one rate priced from its totals', () => {
      expect(costOfUsage('claude-sonnet-5-5', { tokens: usage(1_000_000, 0) })).toEqual({ cost: { amount: '2.00000000', currency: 'USD' }, partial: false })
    })
  })

  it.each([
    ['a price as a number', { input: 0.3, output: '1' }, 'input must be a decimal string above zero'],
    ['a missing output rate', { input: '1' }, 'output must be a decimal string above zero'],
    ['a negative rate', { input: '-1', output: '1' }, 'input must be a decimal string above zero'],
    ['a rate of zero: a model that costs nothing is not a price', { input: '0', output: '1' }, 'input must be a decimal string above zero'],
    ['a rate of zero written as a decimal', { input: '1', output: '0.00' }, 'output must be a decimal string above zero'],
    ['a zero cache rate', { input: '1', output: '1', cacheRead: '0' }, 'cacheRead must be a decimal string above zero'],
    ['an unknown rate', { input: '1', output: '1', bonus: '1' }, 'bonus is not a price field'],
    ['a long-prompt block without its threshold', { input: '1', output: '1', longPrompt: { input: '2', output: '2' } }, 'longPrompt.abovePromptTokens must be a positive integer'],
    ['a long-prompt block with a zero rate', { input: '1', output: '1', longPrompt: { abovePromptTokens: 100, input: '0', output: '2' } }, 'longPrompt.input must be a decimal string above zero']
  ])('refuses %s', (_, price, message) => {
    expect(modelPriceIssues(price, 'price').join('\n')).toContain(message)
  })

  it('accepts a long-prompt block the project declares for its own model', () => {
    expect(modelPriceIssues({ input: '1', output: '2', longPrompt: { abovePromptTokens: 200_000, input: '2', output: '4' } }, 'price')).toEqual([])
  })

  it('refuses a price block that is not keyed by model identifier', () => {
    expect(priceOverrideIssues({ 'bad id': { input: '1', output: '1' } }).join('\n')).toContain('is not a model identifier')
    expect(priceOverrideIssues({ ['x'.repeat(200)]: { input: '1', output: '1' } }).join('\n')).toContain('is not a model identifier')
    expect(priceOverrideIssues([])).toEqual(['routing.adjust.prices must be an object keyed by model identifier'])
    expect(priceOverrideIssues(undefined)).toEqual([])
  })
})
