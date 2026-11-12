import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'

import { isManagedProject, resolveSkillScope, SkillScopeConflictError } from '../../../skill/scope'
import { createTempDir } from '../../helpers/temp-dir'

const NO_FLAGS = { project: false, user: false }

describe('skill scope (#1107)', () => {
  let cwd: string
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    const temp = await createTempDir()
    cwd = temp.dir
    cleanup = temp.cleanup
  })

  afterEach(async () => {
    await cleanup()
  })

  const makeManaged = (dir: string = cwd) => writeFile(join(dir, '.saasfoundry.json'), JSON.stringify({ version: '1.1.0', structure: 'monorepo', projectName: 'demo' }))
  const installProjectCopy = async () => {
    await mkdir(join(cwd, '.claude', 'skills', 'tool-saasfoundry'), { recursive: true })
  }

  describe('isManagedProject', () => {
    it('is true for a directory holding .saasfoundry.json, and false for any other', async () => {
      expect(isManagedProject(cwd)).toBe(false)
      await makeManaged()
      expect(isManagedProject(cwd)).toBe(true)
    })

    it("is false for the CLI's own source repository, whose project skill is a link into the templates", async () => {
      await makeManaged()
      await mkdir(join(cwd, 'bin'), { recursive: true })
      await mkdir(join(cwd, 'src'), { recursive: true })
      await writeFile(join(cwd, 'bin', 'sf.js'), '')
      await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: 'saasfoundryai-cli' }))

      expect(isManagedProject(cwd)).toBe(false)
    })
  })

  describe('with a flag', () => {
    it('--project and --user decide the scope wherever the command runs', async () => {
      await makeManaged()
      for (const action of ['install', 'update', 'uninstall'] as const) {
        expect(await resolveSkillScope({ project: true, user: false }, action, cwd)).toEqual({ scope: 'project', defaulted: false })
        expect(await resolveSkillScope({ project: false, user: true }, action, cwd)).toEqual({ scope: 'user', defaulted: false })
      }
      const elsewhere = await createTempDir()
      try {
        expect(await resolveSkillScope({ project: true, user: false }, 'install', elsewhere.dir)).toEqual({ scope: 'project', defaulted: false })
        expect(await resolveSkillScope({ project: false, user: true }, 'install', elsewhere.dir)).toEqual({ scope: 'user', defaulted: false })
      } finally {
        await elsewhere.cleanup()
      }
    })

    it('rejects both flags together', async () => {
      await expect(resolveSkillScope({ project: true, user: true }, 'install', cwd)).rejects.toBeInstanceOf(SkillScopeConflictError)
    })
  })

  describe('without a flag', () => {
    it('install goes to the project inside a managed project, and to the user scope elsewhere', async () => {
      expect(await resolveSkillScope(NO_FLAGS, 'install', cwd)).toEqual({ scope: 'user', defaulted: false })
      await makeManaged()
      expect(await resolveSkillScope(NO_FLAGS, 'install', cwd)).toEqual({ scope: 'project', defaulted: true })
    })

    it('update and uninstall follow the install: the project copy when the project has one, the user copy otherwise', async () => {
      await makeManaged()
      for (const action of ['update', 'uninstall'] as const) {
        expect(await resolveSkillScope(NO_FLAGS, action, cwd)).toEqual({ scope: 'user', defaulted: false })
      }
      await installProjectCopy()
      for (const action of ['update', 'uninstall'] as const) {
        expect(await resolveSkillScope(NO_FLAGS, action, cwd)).toEqual({ scope: 'project', defaulted: true })
      }
    })

    it("stays on the user scope in the CLI's own source repository, even for an install", async () => {
      await makeManaged()
      await mkdir(join(cwd, 'bin'), { recursive: true })
      await mkdir(join(cwd, 'src'), { recursive: true })
      await writeFile(join(cwd, 'bin', 'sf.js'), '')
      await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: 'saasfoundryai-cli' }))

      expect(await resolveSkillScope(NO_FLAGS, 'install', cwd)).toEqual({ scope: 'user', defaulted: false })
    })
  })
})
