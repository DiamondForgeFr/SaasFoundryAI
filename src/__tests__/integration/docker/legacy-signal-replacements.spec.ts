import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { CI_LANES } from '../../../../tests/docker/ci-lanes'
import { LEGACY_DOCKER_SCENARIOS, LEGACY_SIGNAL_REPLACEMENTS } from '../../../../tests/docker/legacy-signal-replacements'

const ROOT = resolve(__dirname, '../../../..')

describe('legacy Docker signal replacements', () => {
  it('freezes and maps all 23 retired scenarios', () => {
    expect(LEGACY_DOCKER_SCENARIOS).toHaveLength(23)
    expect(new Set(LEGACY_DOCKER_SCENARIOS).size).toBe(23)
    expect(Object.keys(LEGACY_SIGNAL_REPLACEMENTS).sort()).toEqual([...LEGACY_DOCKER_SCENARIOS].sort())
  })

  it('points every signal at an active lifecycle check or an existing Jest file', () => {
    const checks = new Set([...CI_LANES.normal, ...CI_LANES.full].map((entry) => entry.check))
    for (const scenario of LEGACY_DOCKER_SCENARIOS) {
      const replacements = LEGACY_SIGNAL_REPLACEMENTS[scenario]
      expect(replacements.length).toBeGreaterThan(0)
      for (const replacement of replacements) {
        expect(replacement.signal.trim()).not.toBe('')
        if (replacement.kind === 'lifecycle') expect(checks.has(replacement.target)).toBe(true)
        else expect(existsSync(resolve(ROOT, replacement.target))).toBe(true)
      }
    }
  })
})
