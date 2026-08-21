interface JestProject {
  displayName: string
  setupFilesAfterEnv?: string[]
  globals?: Record<string, unknown>
}

// jest.config.js ships no type declaration, and adding one for a config file read
// by a single spec would be ceremony.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const config = require('../../../jest.config') as { projects: JestProject[] }

describe('jest configuration', () => {
  it('declares all four projects', () => {
    expect(config.projects.map((p) => p.displayName)).toEqual(['unit', 'integration', 'e2e', 'smoke'])
  })

  /**
   * `testTimeout` is a **root-level option only**. A project that declares one gets
   * `Unknown option "testTimeout"` and keeps the 5s default, so the timeout has to
   * come from a setup file. Both halves are asserted because either alone is inert:
   * a budget nobody applies, or a setup file with nothing to apply.
   */
  it.each([
    ['unit', 20000],
    ['integration', 30000],
    ['e2e', 60000],
    ['smoke', 120000]
  ])('gives %s a %ims budget, and the setup file that applies it', (name, expected) => {
    const project = config.projects.find((p) => p.displayName === name)
    expect(project?.globals?.['TEST_TIMEOUT']).toBe(expected)
    expect(project?.setupFilesAfterEnv).toEqual(['<rootDir>/jest.setup.ts'])
  })

  // The `unit` project is the one that went red on unrelated PRs: 23 of its specs
  // spawn shells, and 5s is comfortable only while the runner is idle.
  it('does not leave any project on the 5s default', () => {
    for (const project of config.projects) {
      expect(typeof project.globals?.['TEST_TIMEOUT']).toBe('number')
    }
  })
})
