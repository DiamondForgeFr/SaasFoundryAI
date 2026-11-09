/** @type {import('jest').Config} */
module.exports = {
  // Multi-project configuration for unit, integration, and E2E tests
  projects: [
    {
      displayName: 'unit',
      preset: 'ts-jest',
      testEnvironment: 'node',
      roots: ['<rootDir>/src'],
      testMatch: ['<rootDir>/src/__tests__/unit/**/*.spec.ts'],
      testPathIgnorePatterns: ['/node_modules/', '/dist/', '/scaffolds/', '/.turbo/', '/coverage/'],
      setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
      // 23 unit specs drive workflow-cli.sh / github-projects-cli.sh / srs-cli.sh
      // through execFile. Each costs ~300 ms idle, which is comfortable against
      // 5 s until the runner is loaded — on CI this project runs alongside the
      // Docker matrix, and one spec crossed the line on PR #521. 20 s held until
      // the local CI ran beside several agents' pipelines: on 2026-11-09, at a
      // load average of 40 to 76 on 10 cores, a long tail of spawn-heavy specs
      // that no one had listed went past it in turn (#1205). The budget is a hang
      // guard; the specs whose cost is known declare their own above it.
      globals: { TEST_TIMEOUT: 60000 }
    },
    {
      displayName: 'integration',
      preset: 'ts-jest',
      testEnvironment: 'node',
      roots: ['<rootDir>/src'],
      testMatch: ['<rootDir>/src/__tests__/integration/**/*.spec.ts'],
      testPathIgnorePatterns: ['/node_modules/', '/dist/', '/scaffolds/', '/.turbo/', '/coverage/'],
      globalSetup: '<rootDir>/jest.cli.global-setup.js',
      setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
      // Many specs generate a whole project: 10 to 20 s beside the unit job, and
      // past 30 s once the machine also carries other agents' pipelines (#1205,
      // builders/project-identity). A hang guard, like the unit one; the
      // transitions declare their own, wider budgets.
      globals: { TEST_TIMEOUT: 120000 }
    },
    {
      displayName: 'e2e',
      preset: 'ts-jest',
      testEnvironment: 'node',
      roots: ['<rootDir>/src'],
      testMatch: ['<rootDir>/src/__tests__/e2e/**/*.spec.ts'],
      testPathIgnorePatterns: ['/node_modules/', '/dist/', '/scaffolds/', '/.turbo/', '/coverage/'],
      globalSetup: '<rootDir>/jest.cli.global-setup.js',
      setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
      globals: { TEST_TIMEOUT: 60000 }
    },
    {
      displayName: 'smoke',
      preset: 'ts-jest',
      testEnvironment: 'node',
      roots: ['<rootDir>/src'],
      testMatch: ['<rootDir>/src/__tests__/smoke/**/*.spec.ts'],
      testPathIgnorePatterns: ['/node_modules/', '/dist/', '/scaffolds/', '/.turbo/', '/coverage/'],
      setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
      globals: { TEST_TIMEOUT: 120000 }
    }
  ],
  // Coverage settings apply globally
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/*.spec.ts',
    '!src/**/*.test.ts',
    '!src/__tests__/**',
    // Exclude interactive-only code (prompts, runners, CLI entrypoint, command orchestrators)
    '!src/index.ts',
    '!src/runners/**',
    '!src/prompts/workflow.prompts.ts',
    '!src/prompts/skills.prompts.ts',
    '!src/commands/new.ts',
    '!src/commands/tools.ts',
    '!src/commands/workflow.ts'
  ]
}
