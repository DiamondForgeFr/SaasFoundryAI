module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest'
  },
  // Unit coverage focuses on the hand-written business logic that unit tests are responsible for.
  // Generated code, NestJS wiring (modules/dtos/main), static config and test fixtures are excluded
  // so the threshold below tracks real logic and is not diluted by boilerplate (controllers/guards
  // are validated through the e2e suite, not here).
  collectCoverageFrom: ['**/*.(t|j)s', '!**/*.module.ts', '!**/*.dto.ts', '!**/main.ts', '!**/*.config.ts', '!**/index.ts', '!**/tests/**', '!**/*.spec.ts', '!**/*.e2e-spec.ts'],
  coveragePathIgnorePatterns: ['/node_modules/', '<rootDir>/generated/'],
  // Floors set a few points below the current actuals (stmts 40% / branches 28% / funcs 34% /
  // lines 41%) so they guard against regressions today; raise them as service coverage grows.
  coverageThreshold: {
    global: {
      statements: 38,
      branches: 25,
      functions: 32,
      lines: 38
    }
  },
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@modules/(.*)$': '<rootDir>/modules/$1',
    '^@configs/(.*)$': '<rootDir>/configs/$1',
    '^@common/(.*)$': '<rootDir>/common/$1',
    '^@shared-types/(.*)$': '<rootDir>/shared-types/$1',
    '^@shared-validation/(.*)$': '<rootDir>/shared-validation/$1',
    '^@/(.*)$': '<rootDir>/$1'
  },
  setupFilesAfterEnv: ['<rootDir>/configs/test/unit-mocks-glob.ts']
}
