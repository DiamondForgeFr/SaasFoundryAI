import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { installWorkflowSkill } from '../../../installers/workflow-skill.installer'
import type { WorkflowConfig } from '../../../types'

const REPO_ROOT = path.resolve(__dirname, '../../../..')

/** Prettier rewraps lines and aligns tables; the words and symbols stay: compare on what is left once the whitespace is gone. */
const squash = (text: string): string => text.replace(/\s+/g, '')

// #1099 (and the Solo wording defect #1341): this repository runs the Solo preset, so its own `sf-workflow` skill must be what a
// Solo project receives from the template, not a hand-edited variant. A rule only this repository follows belongs in the
// hand-written part of its AGENTS.md.
describe("this repository's sf-workflow skill is what the Solo preset installs", () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'sf-workflow-dogfood-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('has the entry file of the template, the placeholders filled in, and nothing else', async () => {
    const manifest = JSON.parse(readFileSync(path.join(REPO_ROOT, '.saasfoundry.json'), 'utf8')) as { workflow: WorkflowConfig }
    await installWorkflowSkill({ targetPath: dir, workflow: manifest.workflow, injectSection: false, depositListener: false })

    const installed = await readFile(path.join(dir, '.claude/skills/sf-workflow/SKILL.md'), 'utf8')
    const dogfood = readFileSync(path.join(REPO_ROOT, '.claude/skills/sf-workflow/SKILL.md'), 'utf8')

    expect(installed).not.toMatch(/\{\{[A-Z_]+\}\}/)
    expect(squash(dogfood)).toBe(squash(installed))
  })
})
