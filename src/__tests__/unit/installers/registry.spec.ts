import { moduleInstallers, getModuleInstaller } from '../../../installers/registry'

const EXPECTED_INSTALLERS = ['email', 'storage', 'analytics', 'pwa', 'srs-skill', 'skills', 'core-skills', 'tool-skill', 'workflow-skill', 'harness'] as const

describe('moduleInstallers registry', () => {
  it('exposes every installer named by the framework spec', () => {
    const names = moduleInstallers.map((installer) => installer.name).sort()
    expect(names).toEqual([...EXPECTED_INSTALLERS].sort())
  })

  it.each(EXPECTED_INSTALLERS)('%s installer carries currentVersion=1 and an empty migrations array', (name) => {
    const installer = getModuleInstaller(name)
    expect(installer).toBeDefined()
    expect(installer!.currentVersion).toBe(1)
    expect(installer!.migrations).toEqual([])
  })

  it('every installer migrations array is contiguous (vacuously true today)', () => {
    // Same shape-check the manifest registry enforces. Today every installer
    // ships `migrations: []` so the loop is a no-op — but the assertion is
    // here so the first installer to add a real migration without keeping the
    // chain contiguous fails loudly.
    for (const installer of moduleInstallers) {
      installer.migrations.forEach((migration, index) => {
        expect(migration.from).toBe(index)
        expect(migration.to).toBe(index + 1)
      })
    }
  })
})
