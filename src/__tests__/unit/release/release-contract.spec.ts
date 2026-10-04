import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(__dirname, '../../../..')
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8')
const json = <T>(path: string): T => JSON.parse(read(path)) as T

const stableInstallSurfaces = [
  'README.md',
  'docs/getting-started/installation.md',
  'docs/getting-started/quick-start.md',
  'docs/getting-started/setup-paths.md',
  'docs/fr/getting-started/installation.md',
  'docs/fr/getting-started/quick-start.md',
  'docs/fr/getting-started/setup-paths.md'
]

const stableVersionSurfaces = ['README.md', 'docs/.vitepress/config/navigation.ts', 'docs/guide/project-structure.md', 'docs/fr/guide/project-structure.md']

describe('v1 stable release contract (#488)', () => {
  it('keeps package, lockfile and project manifest on the same stable version', () => {
    const packageJson = json<{ name: string; version: string }>('package.json')
    const lockfile = json<{ version: string; packages: Record<string, { version?: string }> }>('package-lock.json')
    const manifest = json<{ version: string }>('.saasfoundry.json')

    expect(packageJson).toMatchObject({ name: 'saasfoundryai-cli', version: '1.0.0' })
    expect(lockfile.version).toBe(packageJson.version)
    expect(lockfile.packages['']?.version).toBe(packageJson.version)
    expect(manifest.version).toBe(packageJson.version)
    expect(packageJson.version).not.toContain('-')
  })

  it.each(stableInstallSurfaces)('uses the stable package on %s', (path) => {
    const content = read(path)
    expect(content).not.toContain('saasfoundryai-cli@beta')
    expect(content).toContain('saasfoundryai-cli')
  })

  it.each(stableVersionSurfaces)('labels the stable version on %s', (path) => {
    const content = read(path)
    expect(content).toContain('1.0.0')
    expect(content).not.toContain('1.0.0-beta')
  })

  it.each([
    ['docs/changelog.md', '## [Unreleased]', '## [1.0.0] - 2026-09-27'],
    ['docs/fr/changelog.md', '## [Non publié]', '## [1.0.0] - 2026-09-27']
  ])('promotes the shipped changelog while preserving an empty next-release section in %s', (path, unreleased, release) => {
    const content = read(path)
    const start = content.indexOf(unreleased) + unreleased.length
    const end = content.indexOf(release)

    expect(start).toBeGreaterThan(unreleased.length - 1)
    expect(end).toBeGreaterThan(start)
    expect(content.slice(start, end).trim()).toBe('')
  })

  it('uploads the actual VitePress output directory', () => {
    const workflow = read('.github/workflows/deploy-docs.yml')
    expect(workflow).toContain('path: docs-dist')
    expect(workflow).not.toContain('path: docs/.vitepress/dist')

    for (const path of ['docs/GITHUB-PAGES-SETUP.md', 'docs/fr/GITHUB-PAGES-SETUP.md']) {
      expect(read(path)).toContain('docs-dist')
      expect(read(path)).not.toContain('docs/.vitepress/dist')
    }
  })

  it('publishes only through the protected provenance workflow', () => {
    const packageJson = json<{ scripts: Record<string, string> }>('package.json')
    const workflow = read('.github/workflows/publish-stable.yml')
    const guard = read('scripts/verify-publish-context.js')

    expect(packageJson.scripts['publish:beta']).toBeUndefined()
    expect(packageJson.scripts['publish:latest']).toBeUndefined()
    expect(packageJson.scripts.prepublishOnly).toContain('verify-publish-context.js')
    expect(workflow).toContain('environment: npm-production')
    expect(workflow).toContain('id-token: write')
    expect(workflow).toContain('npm publish --provenance --access public --tag latest')
    // #904 — trusted publishing (OIDC) replaced the stored granular token
    expect(workflow).not.toContain('NPM_TOKEN')
    expect(workflow).toContain('refs/tags/$RELEASE_TAG')
    expect(workflow).toContain('git tag --points-at HEAD')
    expect(workflow).toContain('already exists; refusing to overwrite it')
    expect(guard).toContain("process.env.GITHUB_ACTIONS !== 'true'")
    expect(guard).toContain('refs/tags/v${version}')
  })

  it('rejects local publication and accepts only the matching tag context', () => {
    const script = resolve(root, 'scripts/verify-publish-context.js')
    const local = spawnSync(process.execPath, [script], { encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: '', GITHUB_REF: '' } })
    const tagged = spawnSync(process.execPath, [script], { encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/tags/v1.0.0' } })

    expect(local.status).toBe(1)
    expect(local.stderr).toContain('publication must run in GitHub Actions')
    expect(tagged.status).toBe(0)
    expect(tagged.stdout).toContain('Verified protected publish context for v1.0.0')
  })
})
