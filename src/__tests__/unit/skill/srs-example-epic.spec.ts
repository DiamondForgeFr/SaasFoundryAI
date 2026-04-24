import { readFileSync } from 'fs'
import path from 'path'

import { renderEpicPage } from '../../../builders/srs/templates/pages/epic.tpl'
import { EpicSpec } from '../../../builders/srs/types'

// Regression guard for the canonical example shipped with the sf-srs skill.
// The agent is told to reference `templates/examples/example-epic.spec.json`
// as the source of truth for what a complete Epic looks like. If that file
// ever drifts into an invalid EpicSpec shape, the agent would teach itself
// broken structure — so we pin the shape here.
const EXAMPLE_PATHS = [
  path.resolve(__dirname, '../../../../.claude/skills/sf-srs/templates/examples/example-epic.spec.json'),
  path.resolve(__dirname, '../../../../scaffolds/skills-templates/sf-srs/templates/examples/example-epic.spec.json')
]

describe('sf-srs canonical example Epic', () => {
  it.each(EXAMPLE_PATHS)('%s parses as a valid EpicSpec and renders without throwing', (file) => {
    const raw = readFileSync(file, 'utf8')
    const spec = JSON.parse(raw) as EpicSpec

    expect(spec.title).toBeTruthy()
    expect(spec.parentPageId).toBeTruthy()
    expect(spec.urs.length).toBeGreaterThan(0)
    expect(spec.frs.length).toBeGreaterThan(0)
    expect(spec.dsItems?.length ?? 0).toBeGreaterThan(0)
    expect(spec.tcItems?.length ?? 0).toBeGreaterThan(0)
    expect(spec.nfrItems?.length ?? 0).toBeGreaterThan(0)

    // Demonstrates the "at least one TODO TC" and "every NFR is proposed" patterns
    // the skill documents — fail loudly if the example stops teaching those.
    const hasTodoTc = (spec.tcItems ?? []).some((tc) => /TODO/.test(tc.title) || /to write/.test(tc.expectedResult ?? ''))
    expect(hasTodoTc).toBe(true)

    const hasProposedNfr = (spec.nfrItems ?? []).some((nfr) => /proposed.*needs human validation/.test(nfr.target ?? ''))
    expect(hasProposedNfr).toBe(true)

    const page = renderEpicPage(spec)
    expect(page.title).toBe(spec.title)
    expect(page.blocks.length).toBeGreaterThan(0)
  })
})
