import { runModuleMigrations } from '../../../migrations/module/registry'
import type { ModuleMigration } from '../../../migrations/module/types'
import type { SaaSFoundryManifest } from '../../../types'

jest.mock('../../../installers/registry', () => ({
  moduleInstallers: [] as never[]
}))

const installersMock = jest.requireMock('../../../installers/registry') as { moduleInstallers: { name: string; currentVersion: number; migrations: ModuleMigration[] }[] }

const baseManifest = (overrides: Partial<SaaSFoundryManifest> = {}): SaaSFoundryManifest => ({
  version: '1.0.0-beta',
  generatedAt: '2026-04-01T00:00:00.000Z',
  structure: 'cli',
  projectName: 'demo',
  manifestVersion: 2,
  ...overrides
})

const recordedRuns: { module: string; name: string; projectDir: string; manifestVersion: number | undefined }[] = []
const trackingMigration = (module: string, from: number, name = `${module}-${from}`): ModuleMigration => ({
  from,
  to: from + 1,
  name,
  up: async (projectDir, manifest) => {
    recordedRuns.push({ module, name, projectDir, manifestVersion: manifest.manifestVersion })
  }
})

beforeEach(() => {
  recordedRuns.length = 0
  installersMock.moduleInstallers.length = 0
})

describe('runModuleMigrations', () => {
  it('returns empty applied when manifest has no modules', async () => {
    const result = await runModuleMigrations(baseManifest(), '/proj')
    expect(result.applied).toEqual([])
    expect(result.manifest).toEqual(baseManifest())
  })

  it('runs pending migrations and bumps version on success', async () => {
    installersMock.moduleInstallers.push({
      name: 'email',
      currentVersion: 3,
      migrations: [trackingMigration('email', 0), trackingMigration('email', 1), trackingMigration('email', 2)]
    })

    const manifest = baseManifest({
      modules: { email: { provider: 'mailersend', version: 1 } } as SaaSFoundryManifest['modules']
    })

    const result = await runModuleMigrations(manifest, '/proj')

    expect(result.applied).toEqual([{ module: 'email', fromVersion: 1, toVersion: 3, migrations: ['email-1', 'email-2'] }])
    expect(recordedRuns.map((r) => r.name)).toEqual(['email-1', 'email-2'])
    expect(result.manifest.modules).toEqual({ email: { provider: 'mailersend', version: 3 } })
  })

  it('skips when module already at the latest version', async () => {
    installersMock.moduleInstallers.push({
      name: 'email',
      currentVersion: 1,
      migrations: []
    })

    const manifest = baseManifest({
      modules: { email: { provider: 'mailersend', version: 1 } } as SaaSFoundryManifest['modules']
    })

    const result = await runModuleMigrations(manifest, '/proj')

    expect(result.applied).toEqual([])
    expect(result.manifest).toBe(manifest)
  })

  it('ignores modules without a numeric version (legacy / non-versioned shape)', async () => {
    installersMock.moduleInstallers.push({
      name: 'analytics',
      currentVersion: 1,
      migrations: [trackingMigration('analytics', 0)]
    })

    const manifest = baseManifest({
      modules: { analytics: 'enabled' } as unknown as SaaSFoundryManifest['modules']
    })

    const result = await runModuleMigrations(manifest, '/proj')

    expect(result.applied).toEqual([])
    expect(recordedRuns).toEqual([])
  })

  it('ignores modules whose installer is not registered', async () => {
    const manifest = baseManifest({
      modules: { unknownModule: { version: 0 } } as unknown as SaaSFoundryManifest['modules']
    })

    const result = await runModuleMigrations(manifest, '/proj')

    expect(result.applied).toEqual([])
  })

  it('passes projectDir and the upgraded manifest into each migration', async () => {
    installersMock.moduleInstallers.push({
      name: 'email',
      currentVersion: 1,
      migrations: [trackingMigration('email', 0)]
    })

    const manifest = baseManifest({
      modules: { email: { provider: 'none', version: 0 } } as SaaSFoundryManifest['modules']
    })

    await runModuleMigrations(manifest, '/some/proj')

    expect(recordedRuns).toEqual([{ module: 'email', name: 'email-0', projectDir: '/some/proj', manifestVersion: 2 }])
  })

  it('runs each module independently (multiple modules, mixed pending state)', async () => {
    installersMock.moduleInstallers.push(
      { name: 'email', currentVersion: 2, migrations: [trackingMigration('email', 0), trackingMigration('email', 1)] },
      { name: 'storage', currentVersion: 1, migrations: [] }
    )

    const manifest = baseManifest({
      modules: {
        email: { provider: 'mailersend', version: 0 },
        storage: { version: 1 }
      } as unknown as SaaSFoundryManifest['modules']
    })

    const result = await runModuleMigrations(manifest, '/proj')

    expect(result.applied).toEqual([{ module: 'email', fromVersion: 0, toVersion: 2, migrations: ['email-0', 'email-1'] }])
  })

  it('does not mutate the input manifest object', async () => {
    installersMock.moduleInstallers.push({
      name: 'email',
      currentVersion: 1,
      migrations: [trackingMigration('email', 0)]
    })

    const manifest = baseManifest({
      modules: { email: { provider: 'mailersend', version: 0 } } as SaaSFoundryManifest['modules']
    })
    const snapshot = JSON.parse(JSON.stringify(manifest))

    const result = await runModuleMigrations(manifest, '/proj')

    expect(manifest).toEqual(snapshot)
    expect(result.manifest).not.toBe(manifest)
  })

  it('propagates errors from a failing migration', async () => {
    const failing: ModuleMigration = {
      from: 0,
      to: 1,
      name: 'boom',
      up: async () => {
        throw new Error('boom')
      }
    }
    installersMock.moduleInstallers.push({ name: 'email', currentVersion: 1, migrations: [failing] })

    const manifest = baseManifest({
      modules: { email: { provider: 'mailersend', version: 0 } } as SaaSFoundryManifest['modules']
    })

    await expect(runModuleMigrations(manifest, '/proj')).rejects.toThrow(/boom/)
  })
})
