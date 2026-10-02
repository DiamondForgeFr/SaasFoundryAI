import { existsSync } from 'fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'

import { dropStackSkillsWithoutStack, harnessMigrations } from '../../../installers/harness.migrations'
import { harnessInstallerMeta } from '../../../installers/harness.installer'
import type { SaaSFoundryManifest } from '../../../types'
import { hashFileContent } from '../../../utils'

const SKILL = '.claude/skills/sf-integration-rules'
const MIRROR = '.agents/skills/sf-integration-rules'

// #831 — harness v1 deposited the stack's integration grammar on every project
describe('harness migration v1 → v2: drop-stack-skills-without-stack', () => {
  let dir: string
  let logSpy: jest.SpyInstance

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sf-harness-migration-'))
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(async () => {
    logSpy.mockRestore()
    await rm(dir, { recursive: true, force: true })
  })

  /** Writes each file and records it in fileHashes, as a harness v1 deposit leaves it. */
  const deposit = async (files: Record<string, string>): Promise<Record<string, string>> => {
    const hashes: Record<string, string> = {}
    for (const [relPath, content] of Object.entries(files)) {
      await mkdir(dirname(join(dir, relPath)), { recursive: true })
      await writeFile(join(dir, relPath), content)
      hashes[relPath] = hashFileContent(content)
    }
    return hashes
  }

  const harnessManifest = (fileHashes: Record<string, string>): SaaSFoundryManifest => ({
    version: '1.0.0',
    generatedAt: '2026-10-02T00:00:00Z',
    structure: 'cli',
    projectName: 'external',
    modules: { harness: { version: 1, managed: true } },
    workflow: { tool: 'github-projects' },
    fileHashes
  })

  const output = () => logSpy.mock.calls.flat().join('\n')

  it('is the harness chain v1 → v2', () => {
    expect(harnessMigrations).toEqual([dropStackSkillsWithoutStack])
    expect(dropStackSkillsWithoutStack).toMatchObject({ from: 1, to: 2 })
    expect(harnessInstallerMeta).toMatchObject({ currentVersion: 2, migrations: harnessMigrations })
  })

  it('removes the untouched deposit and its mirror, and their fileHashes entries', async () => {
    const hashes = await deposit({
      [`${SKILL}/SKILL.md`]: 'rules\n',
      [`${SKILL}/backend.md`]: 'backend\n',
      [`${MIRROR}/SKILL.md`]: 'rules\n',
      '.claude/skills/sf-git-commit/SKILL.md': 'commit\n'
    })
    const manifest = harnessManifest(hashes)

    await dropStackSkillsWithoutStack.up(dir, manifest)

    expect(existsSync(join(dir, SKILL))).toBe(false)
    expect(existsSync(join(dir, MIRROR))).toBe(false)
    expect(Object.keys(manifest.fileHashes ?? {})).toEqual(['.claude/skills/sf-git-commit/SKILL.md'])
    expect(await readFile(join(dir, '.claude/skills/sf-git-commit/SKILL.md'), 'utf8')).toBe('commit\n')
    expect(output()).toContain('Removed 3 file(s) of sf-integration-rules')
  })

  it('keeps an edited copy and a file the harness never deposited, with the mirror of the kept copy', async () => {
    const hashes = await deposit({ [`${SKILL}/SKILL.md`]: 'rules\n', [`${SKILL}/backend.md`]: 'backend\n', [`${MIRROR}/SKILL.md`]: 'rules\n' })
    await writeFile(join(dir, `${SKILL}/SKILL.md`), 'rules, edited\n')
    await writeFile(join(dir, `${SKILL}/notes.md`), 'mine\n')
    const manifest = harnessManifest(hashes)

    await dropStackSkillsWithoutStack.up(dir, manifest)

    expect(await readFile(join(dir, `${SKILL}/SKILL.md`), 'utf8')).toBe('rules, edited\n')
    expect(await readFile(join(dir, `${SKILL}/notes.md`), 'utf8')).toBe('mine\n')
    expect(existsSync(join(dir, `${SKILL}/backend.md`))).toBe(false)
    expect(existsSync(join(dir, `${MIRROR}/SKILL.md`))).toBe(true)
    expect(manifest.fileHashes).toEqual({ [`${SKILL}/SKILL.md`]: hashes[`${SKILL}/SKILL.md`], [`${MIRROR}/SKILL.md`]: hashes[`${MIRROR}/SKILL.md`] })
    expect(output()).toContain(`• ${SKILL}/SKILL.md`)
    expect(output()).toContain(`• ${SKILL}/notes.md`)
    expect(output()).not.toContain(`• ${MIRROR}/SKILL.md`)
  })

  it('leaves untracked copies alone, as on a hand-curated repository', async () => {
    await deposit({ [`${SKILL}/SKILL.md`]: 'rules\n' })
    const manifest = harnessManifest({})

    await dropStackSkillsWithoutStack.up(dir, manifest)

    expect(existsSync(join(dir, `${SKILL}/SKILL.md`))).toBe(true)
  })

  it('never touches a project with a technical stack, nor a multirepo child', async () => {
    const files = { [`${SKILL}/SKILL.md`]: 'rules\n' }
    const stack: SaaSFoundryManifest = {
      ...harnessManifest(await deposit(files)),
      structure: 'monorepo',
      modules: { email: { provider: 'none', version: 1 }, s3Setup: 'manual', dbSetup: 'manual', includeAnalytics: false, advancedSkills: [], harness: { version: 1, managed: true } }
    }
    await dropStackSkillsWithoutStack.up(dir, stack)
    expect(existsSync(join(dir, `${SKILL}/SKILL.md`))).toBe(true)

    const child: SaaSFoundryManifest = { ...harnessManifest(await deposit(files)), projection: { kind: 'multirepo-child', rootProjectName: 'external', app: 'api' } }
    await dropStackSkillsWithoutStack.up(dir, child)
    expect(existsSync(join(dir, `${SKILL}/SKILL.md`))).toBe(true)
  })

  it('is idempotent', async () => {
    const manifest = harnessManifest(await deposit({ [`${SKILL}/SKILL.md`]: 'rules\n' }))
    await dropStackSkillsWithoutStack.up(dir, manifest)
    logSpy.mockClear()

    await dropStackSkillsWithoutStack.up(dir, manifest)

    expect(manifest.fileHashes).toEqual({})
    expect(output()).toBe('')
  })
})
