import { apiDocsIdentity, tsStringLiteral } from '../../../utils/api-docs-identity'

describe('apiDocsIdentity (#884)', () => {
  it('names the API after the project, described by the project', () => {
    expect(apiDocsIdentity('acme', 'Acme ledger')).toEqual({ title: 'acme API', description: 'Acme ledger' })
  })

  it('falls back to the title without a description, and keeps one on a single line', () => {
    expect(apiDocsIdentity('acme', '  ')).toEqual({ title: 'acme API', description: 'acme API' })
    expect(apiDocsIdentity('acme', 'Ledger\n  for */ teams').description).toBe('Ledger for * / teams')
  })
})

describe('tsStringLiteral', () => {
  it.each([
    ['plain', "'plain'"],
    ["Acme's ledger", '"Acme\'s ledger"'],
    ['say "hi"', '\'say "hi"\''],
    ["it's \"two\" and 'one'", '"it\'s \\"two\\" and \'one\'"'],
    ['back\\slash', "'back\\\\slash'"]
  ])('quotes %p as prettier with singleQuote prints it', (value, literal) => {
    expect(tsStringLiteral(value)).toBe(literal)
    // eslint-disable-next-line no-eval
    expect(eval(literal)).toBe(value)
  })
})
