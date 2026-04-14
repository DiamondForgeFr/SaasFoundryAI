import { copy } from 'fs-extra'
import { readFile, rm } from 'fs/promises'
import { join, resolve } from 'path'
import { tmpdir } from 'os'

import { installAnalyticsModule } from '../../../installers/analytics.installer'
import { blueprintsPath } from '../../../types'
import { expectFileExists, expectNoTodoMarkers } from '../../helpers/assertions'

describe('installAnalyticsModule (integration)', () => {
  let tempDir: string
  let webPath: string

  beforeEach(async () => {
    tempDir = join(tmpdir(), `sf-analytics-test-${Date.now()}`)
    webPath = join(tempDir, 'apps/test-project-web')

    // Copy the full Web blueprint to temp dir
    await copy(resolve(blueprintsPath, 'web'), webPath)
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  })

  it('should copy analytics overlay module to web app', async () => {
    await installAnalyticsModule({ webPath })

    await expectFileExists(join(webPath, 'src/lib/analytics'))
  })

  it('should uncomment monitoring-active markers in main.tsx', async () => {
    await installAnalyticsModule({ webPath })

    await expectNoTodoMarkers(join(webPath, 'src/main.tsx'), 'monitoring-active')
  })

  it('should have analytics import active in main.tsx after install', async () => {
    await installAnalyticsModule({ webPath })

    const content = await readFile(join(webPath, 'src/main.tsx'), 'utf8')
    expect(content).toContain("import { initAnalytics } from '@/lib/analytics/analytics'")
    expect(content).toContain('initAnalytics()')
  })

  it('should uncomment analytics env vars in .env', async () => {
    await installAnalyticsModule({ webPath })

    const envContent = await readFile(join(webPath, '.env'), 'utf8')

    // After install, these should NOT be commented out
    expect(envContent).toContain('VITE_ANALYTICS_URL=""')
    expect(envContent).toContain('VITE_ANALYTICS_WEBSITE_ID=""')

    // Should not have the commented version
    expect(envContent).not.toContain('# VITE_ANALYTICS_URL=""')
    expect(envContent).not.toContain('# VITE_ANALYTICS_WEBSITE_ID=""')
  })

  it('should not affect other parts of main.tsx', async () => {
    await installAnalyticsModule({ webPath })

    const content = await readFile(join(webPath, 'src/main.tsx'), 'utf8')

    // Should still contain regular imports
    expect(content).toContain("from 'react'")
    expect(content).toContain("from 'react-dom/client'")
    expect(content).toContain('createRoot')
  })

  it('should not affect storage enabled flag in .env', async () => {
    await installAnalyticsModule({ webPath })

    const envContent = await readFile(join(webPath, '.env'), 'utf8')
    expect(envContent).toContain('VITE_STORAGE_ENABLED="false"')
  })
})
