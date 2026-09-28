import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resumeCommand } from '../../../commands/resume'
import * as portsModule from '../../../ports'
import * as runModule from '../../../run'

/**
 * #588 — `sf new` writes everything, then runs the post-setup steps. When one fails, the
 * project is complete minus one step and there was no way to finish it: three commands, one
 * needing a network name derived from the project, another a path that depends on the
 * topology. `sf` knew all of it — it ran them the first time.
 *
 * The guard these tests exist for is the destructive one. `db:setup:dev` is
 * `prisma db push --force-reset`: "finish the setup" must never mean "reset the database you
 * have been working in".
 */

jest.mock('../../../run', () => ({
  run: jest.fn(() => ({ code: 0, stdout: '', stderr: '' })),
  runRequired: jest.fn(() => ({ code: 0, stdout: '', stderr: '' }))
}))

// The probes are real sockets. Left alone they make each case wait out its own timeout,
// and what is under test here is the decision, not whether TCP works.
jest.mock('../../../ports', () => ({
  ...jest.requireActual('../../../ports'),
  canConnect: jest.fn(async () => true),
  waitForPort: jest.fn(async () => true)
}))

const mockedRun = runModule.run as jest.Mock

describe('sf resume (#588)', () => {
  let dir: string
  let cwd: string
  let logged: string[]

  const manifest = (overrides: Record<string, unknown> = {}) => ({
    version: '1.0.0-beta',
    generatedAt: '2026-08-31T00:00:00Z',
    structure: 'multirepo',
    projectName: 'demo',
    modules: { email: { provider: 'none' }, s3Setup: 'manual', dbSetup: 'docker', includeAnalytics: false, advancedSkills: [] },
    ...overrides
  })

  const write = (relative: string, contents = '') => {
    const full = join(dir, relative)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, contents)
  }

  /** Everything present: deps, compose, client. The database's state is the variable. */
  const healthyTree = () => {
    write('.saasfoundry.json', JSON.stringify(manifest()))
    mkdirSync(join(dir, 'apps/demo-api/node_modules'), { recursive: true })
    mkdirSync(join(dir, 'apps/demo-web/node_modules'), { recursive: true })
    mkdirSync(join(dir, 'apps/demo-api/src/generated/prisma'), { recursive: true })
    write('apps/demo-api/docker-compose.dev-services.yml', 'services:\n  db-dev:\n')
    write('apps/demo-api/.env', 'DATABASE_URL="postgresql://db_dev_user:db_dev_password@localhost:5435/db_dev"\n')
  }

  const output = () => logged.join('\n')
  const ranSetupDev = () => mockedRun.mock.calls.some(([cmd]) => String(cmd).includes('db:setup:dev'))

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sf-resume-'))
    cwd = process.cwd()
    process.chdir(dir)
    logged = []
    jest.spyOn(console, 'log').mockImplementation((...args) => void logged.push(args.join(' ')))
    jest.spyOn(console, 'error').mockImplementation((...args) => void logged.push(args.join(' ')))
    mockedRun.mockReset()
    mockedRun.mockImplementation(() => ({ code: 0, stdout: '', stderr: '' }))
    ;(portsModule.canConnect as jest.Mock).mockReset().mockResolvedValue(true)
    ;(portsModule.waitForPort as jest.Mock).mockReset().mockResolvedValue(true)
    process.exitCode = undefined
  })

  afterEach(() => {
    process.chdir(cwd)
    jest.restoreAllMocks()
    rmSync(dir, { recursive: true, force: true })
    process.exitCode = undefined
  })

  /**
   * #623 — `sf new` printed "Finish all of it with one command: sf resume" next to a failed
   * MinIO, and `resume` started `db-dev` and nothing else. The command that promised to
   * finish everything skipped precisely the step that had failed.
   */
  describe('it finishes the storage step it used to skip', () => {
    const ranStorageUp = () => mockedRun.mock.calls.some(([cmd]) => String(cmd).includes('up -d s3-dev s3-init'))

    it('starts the storage containers when the project hosts its own MinIO', async () => {
      write('.saasfoundry.json', JSON.stringify(manifest({ modules: { ...manifest().modules, s3Setup: 'docker' } })))
      mkdirSync(join(dir, 'apps/demo-api/node_modules'), { recursive: true })
      mkdirSync(join(dir, 'apps/demo-web/node_modules'), { recursive: true })
      write('apps/demo-api/docker-compose.dev-services.yml', 'services:\n  db-dev:\n  s3-dev:\n')
      ;(portsModule.canConnect as jest.Mock).mockResolvedValue(false)

      await resumeCommand({})
      expect(ranStorageUp()).toBe(true)
    })

    it('says why it skipped, rather than going quiet, when storage lives elsewhere', async () => {
      healthyTree()
      await resumeCommand({})
      expect(output()).toContain('does not host its own storage')
      expect(ranStorageUp()).toBe(false)
    })

    it('does not let a storage failure hold back the database setup — sf new starts them independently', async () => {
      write('.saasfoundry.json', JSON.stringify(manifest({ modules: { ...manifest().modules, s3Setup: 'docker' } })))
      mkdirSync(join(dir, 'apps/demo-api/node_modules'), { recursive: true })
      mkdirSync(join(dir, 'apps/demo-web/node_modules'), { recursive: true })
      mkdirSync(join(dir, 'apps/demo-api/src/generated/prisma'), { recursive: true })
      write('apps/demo-api/docker-compose.dev-services.yml', 'services:\n  db-dev:\n  s3-dev:\n')
      write('apps/demo-api/.env', 'DATABASE_URL="postgresql://db_dev_user:db_dev_password@localhost:5435/db_dev"\n')
      ;(portsModule.canConnect as jest.Mock).mockResolvedValue(false)
      mockedRun.mockImplementation((cmd: string) => (String(cmd).includes('s3-dev') ? { code: 1, stdout: '', stderr: 'port is already allocated' } : { code: 0, stdout: '0', stderr: '' }))

      await resumeCommand({})
      // The storage step reports blocked; the database step still ran.
      expect(output()).toContain('storage')
      expect(ranSetupDev()).toBe(true)
    })
  })

  describe('it refuses to run where there is nothing to finish', () => {
    it('needs a manifest', async () => {
      await resumeCommand()

      expect(output()).toContain('No .saasfoundry.json here')
      expect(process.exitCode).toBe(1)
    })

    it('says so on the CLI itself rather than pretending', async () => {
      write('.saasfoundry.json', JSON.stringify({ version: '1', generatedAt: 'x', structure: 'cli', projectName: 'sf' }))

      await resumeCommand()

      expect(output()).toContain('there is no scaffold setup to finish')
      expect(process.exitCode).toBe(1)
    })
  })

  describe('the destructive step', () => {
    it('is refused when the database already holds tables', async () => {
      healthyTree()
      // psql reports a non-zero table count: the database is in use.
      mockedRun.mockImplementation((cmd: string) => (String(cmd).includes('information_schema') ? { code: 0, stdout: '14\n', stderr: '' } : { code: 0, stdout: '', stderr: '' }))

      await resumeCommand()

      expect(output()).toContain('would reset it')
      expect(ranSetupDev()).toBe(false)
    })

    it('is refused when the database cannot be read at all', async () => {
      healthyTree()
      mockedRun.mockImplementation((cmd: string) => (String(cmd).includes('information_schema') ? { code: 1, stdout: '', stderr: 'connection refused' } : { code: 0, stdout: '', stderr: '' }))

      await resumeCommand()

      // Declining to touch a database we cannot read is the only safe direction to be wrong in.
      expect(output()).toContain('Refusing to run db:setup:dev')
      expect(ranSetupDev()).toBe(false)
      expect(process.exitCode).toBe(1)
    })

    it('runs on an empty database, which is what it is for', async () => {
      healthyTree()
      mockedRun.mockImplementation((cmd: string) => (String(cmd).includes('information_schema') ? { code: 0, stdout: '0\n', stderr: '' } : { code: 0, stdout: '', stderr: '' }))

      await resumeCommand()

      expect(ranSetupDev()).toBe(true)
    })
  })

  describe('it never re-scaffolds', () => {
    it('touches no builder, only the runtime steps', async () => {
      healthyTree()
      mockedRun.mockImplementation((cmd: string) => (String(cmd).includes('information_schema') ? { code: 0, stdout: '3\n', stderr: '' } : { code: 0, stdout: '', stderr: '' }))

      await resumeCommand()

      const commands = mockedRun.mock.calls.map(([cmd]) => String(cmd))
      expect(commands.some((c) => c.includes('sf new'))).toBe(false)
      expect(commands.some((c) => c.includes('git init'))).toBe(false)
    })
  })

  describe('the topology comes from the manifest', () => {
    it('reads apps/<name>-api in multirepo', async () => {
      healthyTree()
      mockedRun.mockImplementation((cmd: string) => (String(cmd).includes('information_schema') ? { code: 0, stdout: '0\n', stderr: '' } : { code: 0, stdout: '', stderr: '' }))

      await resumeCommand()

      expect(mockedRun.mock.calls.some(([, opts]) => String((opts as { cwd?: string })?.cwd ?? '').includes('apps/demo-api'))).toBe(true)
    })

    it('reads apps/api in monorepo', async () => {
      write('.saasfoundry.json', JSON.stringify(manifest({ structure: 'monorepo' })))
      mkdirSync(join(dir, 'node_modules'), { recursive: true })
      mkdirSync(join(dir, 'apps/api/src/generated/prisma'), { recursive: true })
      write('apps/api/docker-compose.dev-services.yml', 'services:\n')
      write('apps/api/.env', 'DATABASE_URL="postgresql://u:p@localhost:5435/d"\n')
      mockedRun.mockImplementation((cmd: string) => (String(cmd).includes('information_schema') ? { code: 0, stdout: '2\n', stderr: '' } : { code: 0, stdout: '', stderr: '' }))

      await resumeCommand()

      expect(output()).not.toContain('apps/demo-api')
    })
  })

  describe('a project that hosts no database of its own', () => {
    it('says why rather than going quiet', async () => {
      write('.saasfoundry.json', JSON.stringify(manifest({ modules: { email: { provider: 'none' }, s3Setup: 'manual', dbSetup: 'manual', includeAnalytics: false, advancedSkills: [] } })))
      mkdirSync(join(dir, 'apps/demo-api/node_modules'), { recursive: true })
      mkdirSync(join(dir, 'apps/demo-web/node_modules'), { recursive: true })
      mkdirSync(join(dir, 'apps/demo-api/src/generated/prisma'), { recursive: true })

      await resumeCommand()

      expect(output()).toContain('does not host its own database')
      expect(ranSetupDev()).toBe(false)
    })
  })

  describe('dependencies', () => {
    it('installs only what is missing', async () => {
      write('.saasfoundry.json', JSON.stringify(manifest()))
      mkdirSync(join(dir, 'apps/demo-api/node_modules'), { recursive: true })
      mkdirSync(join(dir, 'apps/demo-api/src/generated/prisma'), { recursive: true })

      await resumeCommand()

      const installs = (runModule.runRequired as jest.Mock).mock.calls.map(([label]) => String(label))
      expect(installs.some((l) => l.includes('demo-web'))).toBe(true)
      expect(installs.some((l) => l.includes('demo-api'))).toBe(false)
    })
  })
})
