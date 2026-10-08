import { moduleInstallers, getModuleInstaller } from '../../../installers/registry'

const EXPECTED_INSTALLERS = ['email', 'storage', 'analytics', 'pwa', 'srs-skill', 'skills', 'core-skills', 'tool-skill', 'workflow-skill', 'harness'] as const

describe('moduleInstallers registry', () => {
  it('exposes every installer named by the framework spec', () => {
    const names = moduleInstallers.map((installer) => installer.name).sort()
    expect(names).toEqual([...EXPECTED_INSTALLERS].sort())
  })

  it.each(EXPECTED_INSTALLERS.filter((name) => name !== 'harness'))('%s installer carries currentVersion=1 and an empty migrations array', (name) => {
    const installer = getModuleInstaller(name)
    expect(installer).toBeDefined()
    expect(installer!.currentVersion).toBe(1)
    expect(installer!.migrations).toEqual([])
  })

  it('harness installer is at v2 through its first migration (#831)', () => {
    expect(getModuleInstaller('harness')).toMatchObject({
      currentVersion: 3,
      migrations: [expect.objectContaining({ from: 1, to: 2, name: 'drop-stack-skills-without-stack' }), expect.objectContaining({ from: 2, to: 3, name: 'drop-per-app-claude-in-monorepo' })]
    })
  })

  it('every installer migrations array is contiguous and ends at its currentVersion', () => {
    // Installed modules are stamped with `currentVersion`, 1 before any
    // migration, and the dispatcher runs the migrations whose `from` is at least
    // the installed version. A chain must therefore start at the version the
    // module had before it (not 0, which never runs) and reach `currentVersion`.
    for (const installer of moduleInstallers) {
      installer.migrations.forEach((migration, index) => {
        expect(migration.to).toBe(migration.from + 1)
        if (index > 0) expect(migration.from).toBe(installer.migrations[index - 1].to)
      })
      expect(installer.migrations.at(-1)?.to ?? installer.currentVersion).toBe(installer.currentVersion)
      expect(installer.migrations[0]?.from ?? 1).toBeGreaterThanOrEqual(1)
    }
  })
})
