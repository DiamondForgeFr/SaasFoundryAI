import { costOfTokens, getModelPriceCatalogue, modelPriceIssues, priceOverrideIssues, resolveModelPrice } from '../../../harness/model-prices'
import { getRoutingGrid } from '../../../harness/routing-grid'

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
    expect(costOfTokens('gpt-6.1-sol', { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 })).toBeNull()
    expect(costOfTokens(null, { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 })).toBeNull()
  })

  it('lets the project declare the price of a model, which wins over the catalogue', () => {
    expect(resolveModelPrice('claude-opus-5-5', { 'claude-opus-5-5': { input: '1', output: '2' } })).toEqual({ input: '1', output: '2' })
  })

  it('derives the cache rates from the input rate when the source does not give them', () => {
    // Haiku 5.5 declares neither cache rate: a tenth of its $0.10 input rate to read, 1.25 times it to write
    expect(costOfTokens('claude-haiku-5-5', { input: 0, output: 0, cacheRead: 1_000_000, cacheWrite: 1_000_000 })).toEqual({ amount: '0.13500000', currency: 'USD' })
    // Opus 5.5 declares its cache-read rate ($0.20), not a tenth of its input
    expect(costOfTokens('claude-opus-5-5', { input: 0, output: 0, cacheRead: 1_000_000, cacheWrite: 0 })).toEqual({ amount: '0.20000000', currency: 'USD' })
  })

  it('rounds up once at 1e-8 and never goes through a float', () => {
    expect(costOfTokens('claude-haiku-5-5', { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 })).toEqual({ amount: '0.00000010', currency: 'USD' })
    expect(costOfTokens('claude-haiku-5-5', { input: 0, output: 3, cacheRead: 0, cacheWrite: 0 })).toEqual({ amount: '0.00000150', currency: 'USD' })
  })

  it.each([
    ['a price as a number', { input: 0.3, output: '1' }, 'input must be a non-negative decimal string'],
    ['a missing output rate', { input: '1' }, 'output must be a non-negative decimal string'],
    ['a negative rate', { input: '-1', output: '1' }, 'input must be a non-negative decimal string'],
    ['an unknown rate', { input: '1', output: '1', bonus: '1' }, 'bonus is not a price field']
  ])('refuses %s', (_, price, message) => {
    expect(modelPriceIssues(price, 'price').join('\n')).toContain(message)
  })

  it('refuses a price block that is not keyed by model identifier', () => {
    expect(priceOverrideIssues({ 'bad id': { input: '1', output: '1' } }).join('\n')).toContain('is not a model identifier')
    expect(priceOverrideIssues([])).toEqual(['routing.adjust.prices must be an object keyed by model identifier'])
    expect(priceOverrideIssues(undefined)).toEqual([])
  })
})
