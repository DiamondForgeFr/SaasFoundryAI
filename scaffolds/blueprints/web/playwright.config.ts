import { defineConfig, devices } from '@playwright/test'

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests/e2e/specs',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 1 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI || process.env.E2E_DEBUG ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: process.env.E2E_DEBUG ? 'http://localhost:5173' : 'http://localhost:4173',
    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    viewport: { width: 1300, height: 1100 },
    /* A service worker (the PWA module registers one in the preview build) answers requests
       before `page.route` sees them, so WebKit specs would hit the network instead of their
       mocks. The specs test the app, not offline behaviour: keep workers out. */
    serviceWorkers: 'block'
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Force viewport even in debug mode
        viewport: { width: 1300, height: 1100 },
        launchOptions: {
          args: ['--window-size=1300,1100']
        }
      }
    },

    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        viewport: { width: 1300, height: 1100 }
      }
    },

    {
      name: 'webkit',
      use: {
        ...devices['Desktop Safari'],
        viewport: { width: 1300, height: 1100 }
      }
    }
  ],

  /* Run your local dev server before starting the tests. On CI it serves the existing build
     (`dist/`): the pipeline builds first (Turborepo's `test:e2e` depends on `build` in a
     monorepo, the lifecycle lane runs `npm run build` in a standalone app). */
  webServer: {
    command: process.env.CI
      ? 'npm run preview -- --mode test --strictPort'
      : process.env.E2E_DEBUG
        ? 'npm run dev -- --mode test --strictPort'
        : 'npm run build && npm run preview -- --mode test --strictPort',
    url: process.env.E2E_DEBUG ? 'http://localhost:5173' : 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
})
