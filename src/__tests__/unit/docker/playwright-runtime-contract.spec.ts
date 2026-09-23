import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

interface PlaywrightRuntimeContract {
  schemaVersion: 1
  playwright: {
    version: string
    image: string
    manifestDigest: string
    distribution: string
    nodeMajor: number
    platformDigests: Record<'linux/amd64' | 'linux/arm64', string>
  }
}

const ROOT = resolve(__dirname, '../../../..')

async function json<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(join(ROOT, path), 'utf8')) as T
}

describe('Playwright lifecycle image contract', () => {
  it('pins one exact multi-architecture image and package version everywhere', async () => {
    const runtime = await json<PlaywrightRuntimeContract>('tests/docker/playwright-runtime.json')
    const runtimePackage = await json<{ dependencies: Record<string, string> }>('tests/docker/runtime/package.json')
    const runtimeLock = await json<{ packages: Record<string, { dependencies?: Record<string, string>; version?: string }> }>('tests/docker/runtime/package-lock.json')
    const dockerfile = await readFile(join(ROOT, 'Dockerfile.test'), 'utf8')
    const monorepoPackage = await json<{ devDependencies: Record<string, string> }>('scaffolds/overlays/monorepo/web/package.json')
    const multirepoPackage = await json<{ devDependencies: Record<string, string> }>('scaffolds/overlays/multirepo/web/package.json')
    const multirepoLock = await json<{
      packages: Record<string, { devDependencies?: Record<string, string>; version?: string }>
    }>('scaffolds/overlays/multirepo/web/package-lock.json')

    expect(runtime).toEqual({
      schemaVersion: 1,
      playwright: {
        version: '1.59.1',
        image: 'mcr.microsoft.com/playwright:v1.59.1-noble',
        manifestDigest: 'sha256:b0ab6f3cb99aa7803adbc14d9027ec1785fc6e433b97e134e0f8fe61683b6b53',
        distribution: 'ubuntu-24.04-noble',
        nodeMajor: 24,
        platformDigests: {
          'linux/amd64': 'sha256:eac9b0a5312cdab40ee8c2429df5bf19bffdccf8f3bf3c42268e173f97541645',
          'linux/arm64': 'sha256:040190be07ce081a025d95f2aeab57b588bed4f19165c1c93cb765372d368463'
        }
      }
    })

    const imageReference = `${runtime.playwright.image}@${runtime.playwright.manifestDigest}`
    expect(dockerfile).toContain(`ARG PLAYWRIGHT_IMAGE=${imageReference}`)
    expect(dockerfile.match(/^FROM \$\{PLAYWRIGHT_IMAGE\}/gm)).toHaveLength(2)
    expect(dockerfile).toContain('ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1')
    expect(dockerfile).not.toMatch(/node:.*alpine|\bapk\b/)
    expect(dockerfile).not.toMatch(/(?:ENV\s+PGDATA|\binitdb\b)/)
    expect(dockerfile).toContain('COPY tests/docker/runtime/package.json tests/docker/runtime/package-lock.json ./')
    expect(dockerfile).toContain('RUN npm ci --ignore-scripts')
    expect(dockerfile).not.toContain('npm install --no-save')

    expect(runtimePackage.dependencies['@playwright/test']).toBe(runtime.playwright.version)
    expect(runtimeLock.packages[''].dependencies?.['@playwright/test']).toBe(runtime.playwright.version)
    expect(runtimeLock.packages['node_modules/@playwright/test'].version).toBe(runtime.playwright.version)
    expect(runtimeLock.packages['node_modules/playwright'].version).toBe(runtime.playwright.version)
    expect(runtimeLock.packages['node_modules/playwright-core'].version).toBe(runtime.playwright.version)

    expect(monorepoPackage.devDependencies['@playwright/test']).toBe(runtime.playwright.version)
    expect(multirepoPackage.devDependencies['@playwright/test']).toBe(runtime.playwright.version)
    expect(multirepoLock.packages[''].devDependencies?.['@playwright/test']).toBe(runtime.playwright.version)
    expect(multirepoLock.packages['node_modules/@playwright/test'].version).toBe(runtime.playwright.version)
    expect(multirepoLock.packages['node_modules/playwright'].version).toBe(runtime.playwright.version)
    expect(multirepoLock.packages['node_modules/playwright-core'].version).toBe(runtime.playwright.version)
  })

  it('runs with Playwright isolation flags and mounts diagnostics only', async () => {
    const runner = await readFile(join(ROOT, 'tests/docker/run-docker-tests.sh'), 'utf8')
    const workflow = await readFile(join(ROOT, '.github/workflows/test.yml'), 'utf8')
    const dockerRun = runner.match(/docker run --rm[\s\S]*?"\$IMAGE_NAME"/)?.[0]

    expect(runner).toContain('docker run --rm --init --ipc=host')
    expect(runner).toContain('target=/artifacts')
    expect(runner).toContain('SF_TEST_ARTIFACTS_DIR=/artifacts')
    expect(dockerRun).toBeDefined()
    expect(dockerRun).not.toMatch(/(?:^|\s)(?:-p|--publish)(?:\s|=)/m)
    expect(dockerRun).not.toContain('/var/run/docker.sock')
    expect(dockerRun).not.toMatch(/--platform(?:\s|=)linux\/amd64/)
    expect(workflow).toContain('docker run --rm --init --ipc=host')
    expect(workflow).toContain('target=/artifacts')
    expect(workflow).not.toContain('/var/run/docker.sock')
  })

  it('uses one tracked credential-safe Docker context policy locally and in CI', async () => {
    const canonical = await readFile(join(ROOT, '.dockerignore'), 'utf8')
    const testPolicy = await readFile(join(ROOT, '.dockerignore.test'), 'utf8')
    const normalize = (value: string) =>
      value
        .split('\n')
        .filter((line) => line.trim() && !line.startsWith('#'))
        .sort()

    expect(normalize(canonical)).toEqual(normalize(testPolicy))
    expect(canonical).toContain('/.claude/')
    expect(canonical).toContain('/.agents/')
    expect(canonical).toContain('.env.*')
    expect(canonical).toContain('.npmrc')
    expect(canonical).toContain('*.pem')
  })
})
