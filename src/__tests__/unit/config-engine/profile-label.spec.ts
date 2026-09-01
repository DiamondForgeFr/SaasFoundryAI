import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { profileStep } from '../../../config-engine/steps/profile.step'

/**
 * #628 — a user answered "Technical stack only: no AI workflow configuration" and found
 * `.claude/settings.json`, `.claude/docs/`, seven skills and a root `CLAUDE.md` in the
 * generated project.
 *
 * The installer is not the defect. `new.ts` records why every scaffolded profile deposits
 * the core harness artefacts — so `sf update` can refresh them on any profile — and the
 * deposited settings register a hook pointing into `.claude/skills/`, so dropping the
 * skills while keeping the settings would ship a broken configuration.
 *
 * The label was the defect: it promised an absence the command does not deliver. These
 * tests hold the label to what actually happens, in both directions.
 */

const stackChoice = () => {
  const field = profileStep.fields!.find((f) => f.name === 'profile')!
  const choices = field.choices as { name: string; value: string }[]
  return choices.find((c) => c.value === 'stack')!
}

describe('the stack profile label describes what stack installs (#628)', () => {
  it('offers the three profiles', () => {
    const values = (profileStep.fields![0].choices as { value: string }[]).map((c) => c.value)
    expect(values).toEqual(['full', 'harness', 'stack'])
  })

  it('no longer claims there is no AI configuration at all', () => {
    // The exact sentence a user read as "no .claude/ directory".
    expect(stackChoice().name).not.toContain('no AI workflow configuration')
  })

  it('names what is actually skipped', () => {
    expect(stackChoice().name).toMatch(/no workflow tool/i)
    expect(stackChoice().name).toMatch(/no SRS/i)
  })

  it('says out loud that skills are still installed, which is the part that surprised someone', () => {
    expect(stackChoice().name).toMatch(/skills still included/i)
  })

  it('matches the installer, which deposits the harness on every scaffolded profile', () => {
    // If someone later gates installSkills on the profile, this fails and sends them back
    // here — the label and the behaviour are only allowed to move together.
    const newTs = readFileSync(resolve(__dirname, '../../../commands/new.ts'), 'utf8')
    const call = newTs.slice(newTs.indexOf('await installSkills({'), newTs.indexOf('await installSkills({') + 200)
    expect(call).not.toContain('profile')
    expect(newTs).toContain('harness: { version: harnessInstallerMeta.currentVersion }')
  })
})
