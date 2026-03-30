/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  // Exclude scaffolds - they are templates for generated projects, not CLI code
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/scaffolds/', '/.turbo/', '/coverage/'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts', '!src/**/*.spec.ts', '!src/**/*.test.ts']
}
