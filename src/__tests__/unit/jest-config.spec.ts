import { readFileSync, readdirSync } from 'fs'
import { join, resolve } from 'path'

interface JestProject {
  displayName: string
  globalSetup?: string
  setupFilesAfterEnv?: string[]
  globals?: Record<string, unknown>
}

// jest.config.js ships no type declaration, and adding one for a config file read
// by a single spec would be ceremony.
const config = require('../../../jest.config') as { projects: JestProject[] }
const COMPILED_CLI_SUITES = [resolve(__dirname, '../integration'), resolve(__dirname, '../e2e')]

function listSpecs(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return listSpecs(path)
    return entry.name.endsWith('.spec.ts') ? [path] : []
  })
}

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

  it('compiles the CLI once through a shared integration and E2E global setup', () => {
    const projectsWithGlobalSetup = config.projects.filter((project) => project.globalSetup !== undefined)

    expect(projectsWithGlobalSetup).toEqual([
      expect.objectContaining({
        displayName: 'integration',
        globalSetup: '<rootDir>/jest.cli.global-setup.js'
      }),
      expect.objectContaining({
        displayName: 'e2e',
        globalSetup: '<rootDir>/jest.cli.global-setup.js'
      })
    ])
  })

  it('does not compile TypeScript independently inside integration or E2E specs', () => {
    for (const suite of COMPILED_CLI_SUITES) {
      for (const spec of listSpecs(suite)) {
        expect(readFileSync(spec, 'utf8')).not.toContain('typescript/bin/tsc')
      }
    }
  })
})
