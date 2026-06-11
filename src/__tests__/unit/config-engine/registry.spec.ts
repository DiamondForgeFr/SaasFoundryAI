import { assertStepRegistry } from '../../../config-engine/registry'
import { StepDefinition } from '../../../config-engine/types'

const fieldsStep = (id: string, names: string[]): StepDefinition => ({
  id,
  title: id,
  fields: names.map((name) => ({ type: 'input' as const, name, message: name }))
})

describe('assertStepRegistry', () => {
  it('accepts a well-formed registry', () => {
    expect(() => assertStepRegistry([fieldsStep('a', ['x']), fieldsStep('b', ['y'])])).not.toThrow()
  })

  it('rejects an empty step id', () => {
    expect(() => assertStepRegistry([fieldsStep('', ['x'])])).toThrow(/non-empty id/)
  })

  it('rejects duplicate step ids', () => {
    expect(() => assertStepRegistry([fieldsStep('a', ['x']), fieldsStep('a', ['y'])])).toThrow(/duplicate step id "a"/)
  })

  it('rejects a step with neither fields nor collect', () => {
    expect(() => assertStepRegistry([{ id: 'empty', title: 'empty' }])).toThrow(/neither fields nor collect/)
  })

  it('accepts a collect-only step', () => {
    expect(() => assertStepRegistry([{ id: 'c', title: 'c', collect: async () => ({}) }])).not.toThrow()
  })

  it('rejects the same field name declared by two different steps', () => {
    expect(() => assertStepRegistry([fieldsStep('a', ['x']), fieldsStep('b', ['x'])])).toThrow(/field "x" is declared by both "a" and "b"/)
  })

  it('allows duplicate field names within one step (mutually exclusive `when` variants)', () => {
    expect(() => assertStepRegistry([fieldsStep('a', ['setupRepo', 'setupRepo'])])).not.toThrow()
  })

  it('collapses dot-notation siblings under the same step', () => {
    expect(() => assertStepRegistry([fieldsStep('db', ['dbCredentials.host', 'dbCredentials.port'])])).not.toThrow()
  })
})
