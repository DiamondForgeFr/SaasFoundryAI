import { buildManifestTools } from '../../../commands/new.manifest-tools'
import { Answers, SrsToolConfig } from '../../../types'

const srs: SrsToolConfig = { enabled: true, backend: 'notion' }
const answers = (toolSelections?: Answers['toolSelections']): Answers => ({ projectName: 'acme', toolSelections }) as Answers

describe('buildManifestTools', () => {
  it('returns undefined when there is neither SRS nor any selection (byte-identical to the old behaviour)', () => {
    expect(buildManifestTools(undefined, answers())).toBeUndefined()
  })

  it('keeps the SRS-only shape unchanged when no tools were selected', () => {
    expect(buildManifestTools(srs, answers())).toEqual({ srs })
  })

  it('merges the tools-first selections alongside SRS', () => {
    const result = buildManifestTools(srs, answers({ tracker: { name: 'github-projects' }, docs: { name: 'notion' }, design: [{ name: 'figma' }] }))
    expect(result).toEqual({ srs, tracker: { name: 'github-projects' }, docs: { name: 'notion' }, design: [{ name: 'figma' }] })
  })

  it('persists selections even without SRS', () => {
    expect(buildManifestTools(undefined, answers({ tracker: { name: 'linear' } }))).toEqual({ tracker: { name: 'linear' } })
  })

  it('omits empty categories rather than writing undefined sub-blocks', () => {
    expect(buildManifestTools(undefined, answers({ tracker: { name: '' }, design: [] }))).toBeUndefined()
  })
})
