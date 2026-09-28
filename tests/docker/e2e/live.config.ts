import { defineConfig, devices } from '@playwright/test'

import { parseLiveSuiteContract } from './contracts'

const contract = parseLiveSuiteContract()
const remaining = Math.max(1_000, contract.deadline - Date.now())
const chromium = { browserName: 'chromium' as const }
const fullJourneyProjects = [
  { name: 'bootstrap', testMatch: '00-bootstrap-auth.spec.ts', use: chromium },
  { name: 'invitation', testMatch: '10-account-owner-invitation.spec.ts', dependencies: ['bootstrap'], use: chromium },
  { name: 'account-entity-preferences', testMatch: '20-account-entity-preferences.spec.ts', dependencies: ['invitation'], use: chromium },
  { name: 'user-role-scope', testMatch: '25-user-role-scope.spec.ts', dependencies: ['account-entity-preferences'], use: chromium },
  { name: 'rbac-scope', testMatch: '30-rbac-scope.spec.ts', dependencies: ['user-role-scope'], use: chromium },
  { name: 'module-lifecycle', testMatch: '40-module-lifecycle.spec.ts', dependencies: ['rbac-scope'], use: chromium },
  { name: 'reactivation', testMatch: '50-reactivation.spec.ts', dependencies: ['module-lifecycle'], use: chromium }
]
const smokeJourneyProjects = [
  { name: 'bootstrap-smoke', testMatch: '00-bootstrap-auth.spec.ts', use: chromium },
  { name: 'invitation-smoke', testMatch: '10-account-owner-invitation.spec.ts', dependencies: ['bootstrap-smoke'], use: chromium },
  { name: 'rbac-smoke', testMatch: '30-rbac-scope.spec.ts', dependencies: ['invitation-smoke'], use: chromium }
]

export default defineConfig({
  testDir: './journeys',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: Math.min(90_000, remaining),
  globalTimeout: remaining,
  grep: contract.depth === 'smoke' ? /@smoke/ : /@(smoke|full)/,
  outputDir: contract.outputDir,
  reporter: [['line'], ['json', { outputFile: contract.resultPath }]],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: contract.webUrl,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    screenshot: 'only-on-failure',
    trace: 'off',
    serviceWorkers: 'block',
    viewport: { width: 1300, height: 1100 }
  },
  projects: contract.depth === 'smoke' ? smokeJourneyProjects : fullJourneyProjects
})
