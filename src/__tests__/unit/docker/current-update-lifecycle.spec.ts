import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '../../../..')

describe('current monorepo update lifecycle contract', () => {
  it('generates fresh full projects with credential-backed storage wiring', async () => {
    const source = await readFile(resolve(ROOT, 'tests/docker/generate-and-build.ts'), 'utf8')

    expect(source).toContain("'--s3-setup',\n          'credentials'")
    expect(source).toContain("'--s3-endpoint'")
    expect(source).toContain("'--s3-secret-key'")
    expect(source).toContain("'sf-lifecycle'")
  })

  it('uses the real CLI, preserved PostgreSQL, late capabilities and repeated update', async () => {
    const source = await readFile(resolve(ROOT, 'tests/docker/generate-and-build.ts'), 'utf8')
    const scenarios = await readFile(resolve(ROOT, 'tests/docker/scenarios.ts'), 'utf8')

    expect(scenarios).toContain("name: 'update-current-monorepo'")
    expect(source).toContain("phase: 'before-update'")
    expect(source).toContain("phase: 'after-update'")
    expect(source).toContain("'--target-profile', 'full'")
    expect(source).toContain("'email,storage,analytics,pwa,sf-skill-context7'")
    expect(source).toContain('SF_CURRENT_UPDATE_CANARY')
    expect(source).toContain('repeated current monorepo update is byte-idempotent')
    expect(source).toContain('signal: LIFECYCLE_ABORT.signal')
    expect(source).toContain('maxEntryBytes: 4 * 1024 * 1024')
    expect(source).toContain('maxAggregateBytes: 32 * 1024 * 1024')
  })
})
