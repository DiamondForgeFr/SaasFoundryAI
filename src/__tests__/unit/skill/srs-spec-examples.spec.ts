import { readFileSync } from 'fs'
import { join, resolve } from 'path'

import { checkSpec, normalizeCandidates } from '../../../srs/bin/write-srs'

const SKILL = resolve(__dirname, '../../../../scaffolds/skills-templates/sf-srs')

// The single-pass example of the skill attached an FR to a feature, which the batch check has
// refused since #850, and nothing ran it: an agent copying the documented shape got exit 2 (#899).
// The skill carries no inline payload any more (#1098): it points at the example file, which this spec runs.
describe('sf-srs spec examples pass the batch check', () => {
  it('SKILL.md points at the three-levels example, the shape an agent copies', () => {
    const skill = readFileSync(join(SKILL, 'SKILL.md'), 'utf8')
    expect(skill).toContain('templates/examples/example-three-levels.spec.json')
  })

  it('templates/examples/example-three-levels.spec.json', () => {
    const spec = normalizeCandidates(JSON.parse(readFileSync(join(SKILL, 'templates/examples/example-three-levels.spec.json'), 'utf8')))

    expect(spec.length).toBeGreaterThan(2)
    expect(checkSpec(spec).errors).toEqual([])
  })
})
