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
  name: string
  version: string
  lockfileVersion: number
  packages: Record<string, LockPackage>
}

const ROOT = resolve(__dirname, '../../..')
const MULTIREPO = join(ROOT, 'scaffolds', 'overlays', 'multirepo')
const MONOREPO_ROOT = join(ROOT, 'scaffolds', 'overlays', 'monorepo', 'root', 'package.json')
const MONOREPO_WEB = join(ROOT, 'scaffolds', 'overlays', 'monorepo', 'web', 'package.json')
// Vite 8.2.0 to 8.2.3 carry six advisories: 8.2.4 is the first patched release, and the templates pin a later one.
const VITE_PATCHED_FLOOR = '8.2.4'
const SECURITY_OVERRIDES = {
  '@nestjs/platform-express': { multer: '2.5.0' },
  '@nestjs/swagger': { 'js-yaml': '5.5.0' },
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
  if (lock.name !== manifest.name) drift.push(`top-level name: expected ${manifest.name}, received ${lock.name}`)
  if (lock.version !== manifest.version) drift.push(`top-level version: expected ${manifest.version}, received ${lock.version}`)
  if (lockRoot.name !== manifest.name) drift.push(`name: expected ${manifest.name}, received ${lockRoot.name}`)
  if (lockRoot.version !== manifest.version) drift.push(`version: expected ${manifest.version}, received ${lockRoot.version}`)

  for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'engines'] as const) {
    if (!isDeepStrictEqual(lockRoot[section] ?? {}, manifest[section] ?? {})) drift.push(`${section} differs from package.json`)
  }
  return drift
}

function minimumResolutionDrift(lock: PackageLock, expected: Record<string, string>): string[] {
  const toParts = (version: string): number[] | undefined => {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
    return match ? match.slice(1).map(Number) : undefined
  }

  return Object.entries(expected).flatMap(([dependency, minimum]) => {
    const minimumParts = toParts(minimum)!
    const resolved = versionsOf(lock, dependency)
    const isPatched =
      resolved.length > 0 &&
      resolved.every((version) => {
        const parts = toParts(version)
        if (!parts) return false
        for (let index = 0; index < parts.length; index += 1) {
          if (parts[index] > minimumParts[index]) return true
          if (parts[index] < minimumParts[index]) return false
        }
        return true
      })
    return isPatched ? [] : [`${dependency}: expected every resolution to be at least ${minimum}, received ${resolved.join(', ') || 'nothing'}`]
  })
}

function resolutionDrift(lock: PackageLock, expected: Record<string, string>): string[] {
  return Object.entries(expected).flatMap(([dependency, version]) => {
    const resolved = versionsOf(lock, dependency)
    return resolved.length === 1 && resolved[0] === version ? [] : [`${dependency}: expected only ${version}, received ${resolved.join(', ') || 'nothing'}`]
  })
}

/**
 * The copy of `dependency` that `parent` loads, found the way Node finds it: the parent's own
 * `node_modules` first, then each enclosing one. A lock can hold several copies of the same
 * package (the API lock holds three js-yaml majors), and only this one is what the parent runs.
 */
function resolutionFrom(lock: PackageLock, parent: string, dependency: string, version: string): string[] {
  let base = `node_modules/${parent}`
  for (;;) {
    const candidate = lock.packages[`${base}/node_modules/${dependency}`]
    if (candidate) {
      return candidate.version === version ? [] : [`${parent} -> ${dependency}: expected ${version}, received ${candidate.version}`]
    }
    const enclosing = base.lastIndexOf('/node_modules/')
    if (enclosing === -1) break
    base = base.slice(0, enclosing)
  }
  const hoisted = lock.packages[`node_modules/${dependency}`]
  return hoisted?.version === version ? [] : [`${parent} -> ${dependency}: expected ${version}, received ${hoisted?.version ?? 'nothing'}`]
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

    expect(resolutionDrift(api!.lock, { multer: '2.5.0', 'deepmerge-ts': '8.0.2', mysql2: '3.24.4' })).toEqual([])
    // The lock holds three js-yaml copies, so the swagger one is read from where swagger loads it.
    expect(resolutionFrom(api!.lock, '@nestjs/swagger', 'js-yaml', '5.5.0')).toEqual([])
  })

  it('resolves patched shared parser dependencies from a fresh lock', () => {
    const api = fixtures.find((fixture) => fixture.app === 'api')
    const web = fixtures.find((fixture) => fixture.app === 'web')

    expect(minimumResolutionDrift(api!.lock, { 'fast-uri': '3.1.9', handlebars: '4.7.10', qs: '6.16.0' })).toEqual([])
    expect(minimumResolutionDrift(web!.lock, { 'fast-uri': '3.1.9', 'source-map-js': '1.2.2' })).toEqual([])
  })

  it('resolves the pinned, patched Vite in the web lock and keeps both web overlays on the same pin', () => {
    const web = fixtures.find((fixture) => fixture.app === 'web')!
    const monorepoWeb = readJson<PackageManifest>(MONOREPO_WEB)
    const pin = web.manifest.devDependencies?.vite

    expect(pin).toMatch(/^\d+\.\d+\.\d+$/)
    expect(monorepoWeb.devDependencies?.vite).toBe(pin)
    expect(resolutionDrift(web.lock, { vite: pin! })).toEqual([])
    expect(minimumResolutionDrift(web.lock, { vite: VITE_PATCHED_FLOOR })).toEqual([])
  })

  it('fails when a lock root omits a dependency or pins a different version', () => {
    const api = fixtures.find((fixture) => fixture.app === 'api')!
    const missingDependency = structuredClone(api.lock)
    delete missingDependency.packages[''].dependencies?.mailersend

    const staleVersion = structuredClone(api.lock)
    staleVersion.packages[''].dependencies = { ...staleVersion.packages[''].dependencies, mailersend: '2.8.0' }

    const staleMetadata = structuredClone(api.lock)
    staleMetadata.name = 'stale-api-name'

    expect(manifestLockDrift(api.manifest, missingDependency)).toContain('dependencies differs from package.json')
    expect(manifestLockDrift(api.manifest, staleVersion)).toContain('dependencies differs from package.json')
    expect(manifestLockDrift(api.manifest, staleMetadata)).toContain(`top-level name: expected ${api.manifest.name}, received stale-api-name`)
  })

  it('fails when a vulnerable transitive resolution returns', () => {
    const api = fixtures.find((fixture) => fixture.app === 'api')!
    const staleLock = structuredClone(api.lock)
    staleLock.packages['node_modules/multer'].version = '2.4.0'

    expect(resolutionDrift(staleLock, { multer: '2.5.0' })).toEqual(['multer: expected only 2.5.0, received 2.4.0'])
  })

  it('fails when swagger loads a vulnerable js-yaml, whatever the other copies resolve to', () => {
    const api = fixtures.find((fixture) => fixture.app === 'api')!
    const swaggerCopy = 'node_modules/@nestjs/swagger/node_modules/js-yaml'
    expect(api.lock.packages[swaggerCopy]).toBeDefined()

    const staleLock = structuredClone(api.lock)
    staleLock.packages[swaggerCopy].version = '5.3.0'
    expect(resolutionFrom(staleLock, '@nestjs/swagger', 'js-yaml', '5.5.0')).toEqual(['@nestjs/swagger -> js-yaml: expected 5.5.0, received 5.3.0'])

    // A patched copy elsewhere in the tree must not hide the vulnerable one swagger loads.
    const maskedLock = structuredClone(staleLock)
    maskedLock.packages['node_modules/js-yaml'].version = '5.5.0'
    expect(resolutionFrom(maskedLock, '@nestjs/swagger', 'js-yaml', '5.5.0')).toEqual(['@nestjs/swagger -> js-yaml: expected 5.5.0, received 5.3.0'])

    // With no copy nested under swagger, the hoisted one is what it loads.
    const hoistedLock = structuredClone(api.lock)
    delete hoistedLock.packages[swaggerCopy]
    hoistedLock.packages['node_modules/js-yaml'].version = '5.5.0'
    expect(resolutionFrom(hoistedLock, '@nestjs/swagger', 'js-yaml', '5.5.0')).toEqual([])
    hoistedLock.packages['node_modules/js-yaml'].version = '4.3.2'
    expect(resolutionFrom(hoistedLock, '@nestjs/swagger', 'js-yaml', '5.5.0')).toEqual(['@nestjs/swagger -> js-yaml: expected 5.5.0, received 4.3.2'])
  })

  it('accepts newer parser patches and rejects any vulnerable resolution', () => {
    const api = fixtures.find((fixture) => fixture.app === 'api')!
    const newerLock = structuredClone(api.lock)
    newerLock.packages['node_modules/fast-uri'].version = '3.2.0'
    expect(minimumResolutionDrift(newerLock, { 'fast-uri': '3.1.9' })).toEqual([])

    const staleLock = structuredClone(api.lock)
    staleLock.packages['node_modules/fast-uri'].version = '3.1.8'
    expect(minimumResolutionDrift(staleLock, { 'fast-uri': '3.1.9' })).toEqual(['fast-uri: expected every resolution to be at least 3.1.9, received 3.1.8'])
    staleLock.packages['node_modules/fast-uri'].version = '2.99.0'
    expect(minimumResolutionDrift(staleLock, { 'fast-uri': '3.1.9' })).toEqual(['fast-uri: expected every resolution to be at least 3.1.9, received 2.99.0'])

    const staleHandlebars = structuredClone(api.lock)
    staleHandlebars.packages['node_modules/handlebars'].version = '4.7.9'
    expect(minimumResolutionDrift(staleHandlebars, { handlebars: '4.7.10' })).toEqual(['handlebars: expected every resolution to be at least 4.7.10, received 4.7.9'])
  })

  it('fails when the web lock goes back to a vulnerable Vite, fast-uri or source-map-js', () => {
    const web = fixtures.find((fixture) => fixture.app === 'web')!
    const staleLock = structuredClone(web.lock)
    staleLock.packages['node_modules/vite'].version = '8.2.2'
    staleLock.packages['node_modules/fast-uri'].version = '3.1.8'
    staleLock.packages['node_modules/source-map-js'].version = '1.2.1'

    expect(minimumResolutionDrift(staleLock, { vite: VITE_PATCHED_FLOOR, 'fast-uri': '3.1.9', 'source-map-js': '1.2.2' })).toEqual([
      `vite: expected every resolution to be at least ${VITE_PATCHED_FLOOR}, received 8.2.2`,
      'fast-uri: expected every resolution to be at least 3.1.9, received 3.1.8',
      'source-map-js: expected every resolution to be at least 1.2.2, received 1.2.1'
    ])
    expect(resolutionDrift(staleLock, { vite: web.manifest.devDependencies!.vite })).toEqual([`vite: expected only ${web.manifest.devDependencies!.vite}, received 8.2.2`])
  })
})

/**
 * The CLI, the client and the driver adapter are one Prisma release: #586 bumped
 * two of them and left the adapter behind (#862), which no build or test noticed.
 */
describe('Prisma release line in the API templates', () => {
  const PRISMA_RUNTIME = ['prisma', '@prisma/client', '@prisma/adapter-pg'] as const
  const templates = ['monorepo', 'multirepo'].map((topology) => ({
    topology,
    manifest: readJson<PackageManifest>(join(ROOT, 'scaffolds', 'overlays', topology, 'api', 'package.json'))
  }))

  const declaredVersions = (manifest: PackageManifest): Record<string, string | undefined> =>
    Object.fromEntries(PRISMA_RUNTIME.map((name) => [name, manifest.dependencies?.[name] ?? manifest.devDependencies?.[name]]))

  it.each(templates)('$topology declares prisma, @prisma/client and @prisma/adapter-pg at one version', ({ manifest }) => {
    const versions = declaredVersions(manifest)
    expect(new Set(Object.values(versions)).size).toBe(1)
    expect(versions.prisma).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('resolves the adapter and its driver utilities from the same release in the multirepo lock', () => {
    const directory = join(MULTIREPO, 'api')
    const manifest = readJson<PackageManifest>(join(directory, 'package.json'))
    const lock = readJson<PackageLock>(join(directory, 'package-lock.json'))
    const release = declaredVersions(manifest).prisma!

    expect(resolutionDrift(lock, { prisma: release, '@prisma/client': release, '@prisma/adapter-pg': release, '@prisma/driver-adapter-utils': release })).toEqual([])
  })
})
