import { readFileSync } from 'fs'
import { join, resolve } from 'path'

import type { DraftCandidate } from '../../../builders/srs/types'
import { checkSpec, normalizeCandidates } from '../../../srs/bin/write-srs'

const SKILL = resolve(__dirname, '../../../../scaffolds/skills-templates/sf-srs')

// The single-pass example of the skill attached an FR to a feature, which the batch check has
// refused since #850, and nothing ran it: an agent copying the documented shape got exit 2 (#899)
describe('sf-srs spec examples pass the batch check', () => {
  it('the single-pass example of SKILL.md', () => {
    const skill = readFileSync(join(SKILL, 'SKILL.md'), 'utf8')
    const block = /Example mixed spec[^\n]*\n\n```json\n([\s\S]*?)\n```/.exec(skill)?.[1]
    expect(block).toBeDefined()

    expect(checkSpec(JSON.parse(block!) as DraftCandidate[])).toEqual({ errors: [], warnings: [] })
  })

  it('templates/examples/example-three-levels.spec.json', () => {
    const spec = normalizeCandidates(JSON.parse(readFileSync(join(SKILL, 'templates/examples/example-three-levels.spec.json'), 'utf8')))

    expect(spec.length).toBeGreaterThan(2)
    expect(checkSpec(spec).errors).toEqual([])
  })
})
