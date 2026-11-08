import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'

import { version as cliVersion } from '../../../../package.json'
import { skillCommand } from '../../../commands/skill'
import { fileExists } from '../../../utils'
import { createTempDir } from '../../helpers/temp-dir'

/**
 * `sf skill install` run inside a managed project writes under the project (#1107). The bundle copied is
 * the real `scaffolds/skills-templates/tool-saasfoundry`; the home directory and the project are fixtures.
 */
describe('sf skill: the default scope inside a managed project (#1107)', () => {
  let home: string
  let project: string
  let cleanups: Array<() => Promise<void>>
  let originalHome: string | undefined
  let originalCwd: string
  let exit: jest.SpyInstance

  const userCopy = () => join(home, '.claude', 'skills', 'tool-saasfoundry')
  const projectCopy = () => join(project, '.claude', 'skills', 'tool-saasfoundry')
  const writeVersion = (dir: string, installed: string, scope: 'user' | 'project') =>
    mkdir(dir, { recursive: true }).then(() => writeFile(join(dir, '.version'), JSON.stringify({ cliVersion: installed, installedAt: '2026-10-10T09:00:00.000Z', scope })))
  const versionOf = async (dir: string) => JSON.parse(await readFile(join(dir, '.version'), 'utf8')) as { cliVersion: string; scope: string }

  beforeEach(async () => {
    cleanups = []
    const homeDir = await createTempDir()
    const projectDir = await createTempDir()
    cleanups.push(homeDir.cleanup, projectDir.cleanup)
    home = homeDir.dir
    project = projectDir.dir
    originalHome = process.env.HOME
    originalCwd = process.cwd()
    process.env.HOME = home
    process.chdir(project)
    jest.spyOn(console, 'log').mockImplementation(() => undefined)
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    exit = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`)
    }) as never)
  })

  afterEach(async () => {
    jest.restoreAllMocks()
    process.chdir(originalCwd)
    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome
    await Promise.all(cleanups.map((cleanup) => cleanup()))
  })

  const makeManaged = () => writeFile(join(project, '.saasfoundry.json'), JSON.stringify({ version: '1.1.0', structure: 'monorepo', projectName: 'demo' }))

  it('install writes under the project and leaves the home alone', async () => {
    await makeManaged()

    await skillCommand('install')

    expect(await fileExists(join(projectCopy(), 'SKILL.md'))).toBe(true)
    expect(await versionOf(projectCopy())).toEqual({ cliVersion, installedAt: expect.any(String), scope: 'project' })
    expect(await fileExists(userCopy())).toBe(false)
  })

  it('install --user still writes the personal copy, on purpose', async () => {
    await makeManaged()

    await skillCommand('install', '--user')

    expect(await fileExists(join(userCopy(), 'SKILL.md'))).toBe(true)
    expect(await fileExists(projectCopy())).toBe(false)
  })

  it('install outside a managed project keeps writing the user scope', async () => {
    await skillCommand('install')

    expect(await fileExists(join(userCopy(), 'SKILL.md'))).toBe(true)
    expect(await fileExists(projectCopy())).toBe(false)
  })

  it('install --project outside a managed project still writes under the directory', async () => {
    await skillCommand('install', '--project')

    expect(await fileExists(join(projectCopy(), 'SKILL.md'))).toBe(true)
    expect(await fileExists(userCopy())).toBe(false)
  })

  it('refuses --project together with --user and writes nothing', async () => {
    await makeManaged()

    await expect(skillCommand('install', '--project', '--user')).rejects.toThrow('process.exit(1)')

    expect(exit).toHaveBeenCalledWith(1)
    expect(await fileExists(projectCopy())).toBe(false)
    expect(await fileExists(userCopy())).toBe(false)
  })

  it('tells the developer where the install went, and why', async () => {
    await makeManaged()
    const log = jest.mocked(console.log)

    await skillCommand('install')

    const printed = log.mock.calls.map((call) => String(call[0])).join('\n')
    expect(printed).toContain(projectCopy())
    expect(printed).toContain('Scope:   project (this directory is a SaaSFoundryAI project)')
  })

  it('update and uninstall act on the project copy when the project has one, and leave the personal copy', async () => {
    await makeManaged()
    await writeVersion(projectCopy(), '0.0.1', 'project')
    await writeVersion(userCopy(), '0.0.1', 'user')

    await skillCommand('update')

    expect((await versionOf(projectCopy())).cliVersion).toBe(cliVersion)
    expect((await versionOf(userCopy())).cliVersion).toBe('0.0.1')

    await skillCommand('uninstall', '--yes')

    expect(await fileExists(projectCopy())).toBe(false)
    expect(await fileExists(userCopy())).toBe(true)
  })

  it('update and uninstall act on the personal copy when the project has none, as they always did', async () => {
    await makeManaged()
    await writeVersion(userCopy(), '0.0.1', 'user')

    await skillCommand('update')
    expect((await versionOf(userCopy())).cliVersion).toBe(cliVersion)

    await skillCommand('uninstall', '--yes')
    expect(await fileExists(userCopy())).toBe(false)
  })

  it('uninstall --user removes the personal copy and keeps the project one', async () => {
    await makeManaged()
    await writeVersion(projectCopy(), cliVersion, 'project')
    await writeVersion(userCopy(), cliVersion, 'user')

    await skillCommand('uninstall', '--user', '--yes')

    expect(await fileExists(userCopy())).toBe(false)
    expect(await fileExists(projectCopy())).toBe(true)
  })
})
