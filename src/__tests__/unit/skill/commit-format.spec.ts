import { spawnSync } from 'child_process'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

import { DEFAULT_COMMIT_FORMAT } from '../../../prompts/workflow.prompts'

const CORE = resolve(__dirname, '../../../../scaffolds/skills-templates/core')
const commitSkill = readFileSync(join(CORE, 'sf-git-commit/SKILL.md'), 'utf8')
const fixCommentsSkill = readFileSync(join(CORE, 'sf-git-fix-pr-comments/SKILL.md'), 'utf8')

/** The command whose output the skill's context injects as the commit format. */
const formatCommand = /^- Commit format: !`(.+)`$/m.exec(commitSkill)?.[1]

// #830 — sf-git-commit hardcoded `type(scope): description` and an `update` type, so an agent
// following it broke the `type(#N): description` rule the manifest of the same setup declares
describe('sf-git-commit commit format', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sf-commit-format-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const run = () => spawnSync('/bin/sh', ['-c', formatCommand ?? 'false'], { cwd: dir, encoding: 'utf8' }).stdout.trim()

  it('injects the manifest commit format into its context', async () => {
    expect(formatCommand).toBeDefined()
    await writeFile(join(dir, '.saasfoundry.json'), JSON.stringify({ workflow: { tool: 'github-projects', commitFormat: DEFAULT_COMMIT_FORMAT } }))

    expect(JSON.parse(run())).toEqual(DEFAULT_COMMIT_FORMAT)
  })

  it('prints null without a manifest, or without a workflow', async () => {
    expect(run()).toBe('null')
    await writeFile(join(dir, '.saasfoundry.json'), JSON.stringify({ projectName: 'stack-only' }))
    expect(run()).toBe('null')
  })

  it('may run node, which the injected command needs', () => {
    expect(commitSkill).toMatch(/^allowed-tools: .*Bash\(node :\*\)/m)
  })

  it('falls back to the default types, and never offers a type the default format refuses', () => {
    const fallback = /\*\*Not configured\*\*.*types (.+)$/m.exec(commitSkill)?.[1] ?? ''
    expect([...fallback.matchAll(/`(\w+)`/g)].map((match) => match[1])).toEqual(DEFAULT_COMMIT_FORMAT.types)
    expect(commitSkill).not.toMatch(/`update`/)
  })

  it('stops rather than inventing a required ticket number', () => {
    expect(commitSkill).toContain('never invent one, never drop the `(#N)`')
  })

  it('sf-git-fix-pr-comments commits in the same format', () => {
    expect(fixCommentsSkill).toContain('`fix(#<N>): address PR review comments`')
    expect(fixCommentsSkill).toContain('workflow.commitFormat')
  })
})
