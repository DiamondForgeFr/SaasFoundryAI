import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'

type PackageSection = Record<string, string>

interface PackageManifest {
  name: string
  version: string
  dependencies?: PackageSection
  devDependencies?: PackageSection
  peerDependencies?: PackageSection
  optionalDependencies?: PackageSection
  engines?: PackageSection
  overrides?: Record<string, unknown>
}

interface LockPackage {
  name?: string
  version?: string
  dependencies?: PackageSection
  devDependencies?: PackageSection
  peerDependencies?: PackageSection
  optionalDependencies?: PackageSection
  engines?: PackageSection
}

interface PackageLock {
  lockfileVersion: number
  packages: Record<string, LockPackage>
}

const ROOT = resolve(__dirname, '../../..')
const MULTIREPO = join(ROOT, 'scaffolds', 'overlays', 'multirepo')
const MONOREPO_ROOT = join(ROOT, 'scaffolds', 'overlays', 'monorepo', 'root', 'package.json')
const SECURITY_OVERRIDES = {
  '@nestjs/platform-express': { multer: '2.4.0' },
  '@prisma/config': { 'deepmerge-ts': '8.0.2' },
  prisma: { mysql2: '3.24.4' }
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function versionsOf(lock: PackageLock, dependency: string): string[] {
  const suffix = `/node_modules/${dependency}`
  return [
    ...new Set(
      Object.entries(lock.packages)
        .filter(([path]) => path === `node_modules/${dependency}` || path.endsWith(suffix))
        .map(([, metadata]) => metadata.version)
        .filter((version): version is string => typeof version === 'string')
    )
  ].sort()
}

function manifestLockDrift(manifest: PackageManifest, lock: PackageLock): string[] {
  const lockRoot = lock.packages['']
  if (!lockRoot) return ['lock root is missing']

  const drift: string[] = []
  if (lock.lockfileVersion !== 3) drift.push(`lockfileVersion: expected 3, received ${lock.lockfileVersion}`)
  if (lockRoot.name !== manifest.name) drift.push(`name: expected ${manifest.name}, received ${lockRoot.name}`)
  if (lockRoot.version !== manifest.version) drift.push(`version: expected ${manifest.version}, received ${lockRoot.version}`)

  for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'engines'] as const) {
    if (!isDeepStrictEqual(lockRoot[section] ?? {}, manifest[section] ?? {})) drift.push(`${section} differs from package.json`)
  }
  return drift
}

function resolutionDrift(lock: PackageLock, expected: Record<string, string>): string[] {
  return Object.entries(expected).flatMap(([dependency, version]) => {
    const resolved = versionsOf(lock, dependency)
    return resolved.length === 1 && resolved[0] === version ? [] : [`${dependency}: expected only ${version}, received ${resolved.join(', ') || 'nothing'}`]
  })
}

describe('committed multirepo lockfiles', () => {
  const fixtures = ['api', 'web'].map((app) => {
    const directory = join(MULTIREPO, app)
    return {
      app,
      manifest: readJson<PackageManifest>(join(directory, 'package.json')),
      lock: readJson<PackageLock>(join(directory, 'package-lock.json'))
    }
  })

  it.each(fixtures)('$app lock root matches its package manifest', ({ manifest, lock }) => {
    expect(manifestLockDrift(manifest, lock)).toEqual([])
  })

  it('keeps security overrides scoped to their direct parents at both install roots', () => {
    const api = fixtures.find((fixture) => fixture.app === 'api')
    const monorepoRoot = readJson<PackageManifest>(MONOREPO_ROOT)
    expect(api).toBeDefined()
    expect(api?.manifest.overrides).toEqual(SECURITY_OVERRIDES)
    expect(monorepoRoot.overrides).toEqual(SECURITY_OVERRIDES)

    expect(resolutionDrift(api!.lock, { multer: '2.4.0', 'deepmerge-ts': '8.0.2', mysql2: '3.24.4' })).toEqual([])
  })

  it('resolves patched shared parser dependencies from a fresh lock', () => {
    const api = fixtures.find((fixture) => fixture.app === 'api')
    const web = fixtures.find((fixture) => fixture.app === 'web')

    expect(versionsOf(api!.lock, 'fast-uri')).toEqual(['3.1.8'])
    expect(versionsOf(web!.lock, 'fast-uri')).toEqual(['3.1.8'])
    expect(versionsOf(api!.lock, 'qs')).toEqual(['6.16.0'])
  })

  it('fails when a lock root omits a dependency or pins a different version', () => {
    const api = fixtures.find((fixture) => fixture.app === 'api')!
    const missingDependency = structuredClone(api.lock)
    delete missingDependency.packages[''].dependencies?.mailersend

    const staleVersion = structuredClone(api.lock)
    staleVersion.packages[''].dependencies = { ...staleVersion.packages[''].dependencies, mailersend: '2.8.0' }

    expect(manifestLockDrift(api.manifest, missingDependency)).toContain('dependencies differs from package.json')
    expect(manifestLockDrift(api.manifest, staleVersion)).toContain('dependencies differs from package.json')
  })

  it('fails when a vulnerable transitive resolution returns', () => {
    const api = fixtures.find((fixture) => fixture.app === 'api')!
    const staleLock = structuredClone(api.lock)
    staleLock.packages['node_modules/multer'].version = '2.2.0'

    expect(resolutionDrift(staleLock, { multer: '2.4.0' })).toEqual(['multer: expected only 2.4.0, received 2.2.0'])
  })
})
