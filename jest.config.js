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
      testPathIgnorePatterns: ['/node_modules/', '/dist/', '/scaffolds/', '/.turbo/', '/coverage/']
    },
    {
      displayName: 'integration',
      preset: 'ts-jest',
      testEnvironment: 'node',
      roots: ['<rootDir>/src'],
      testMatch: ['<rootDir>/src/__tests__/integration/**/*.spec.ts'],
      testPathIgnorePatterns: ['/node_modules/', '/dist/', '/scaffolds/', '/.turbo/', '/coverage/'],
      globals: { TEST_TIMEOUT: 30000 }
    },
    {
      displayName: 'e2e',
      preset: 'ts-jest',
      testEnvironment: 'node',
      roots: ['<rootDir>/src'],
      testMatch: ['<rootDir>/src/__tests__/e2e/**/*.spec.ts'],
      testPathIgnorePatterns: ['/node_modules/', '/dist/', '/scaffolds/', '/.turbo/', '/coverage/'],
      globals: { TEST_TIMEOUT: 60000 }
    },
    {
      displayName: 'smoke',
      preset: 'ts-jest',
      testEnvironment: 'node',
      roots: ['<rootDir>/src'],
      testMatch: ['<rootDir>/src/__tests__/smoke/**/*.spec.ts'],
      testPathIgnorePatterns: ['/node_modules/', '/dist/', '/scaffolds/', '/.turbo/', '/coverage/'],
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
