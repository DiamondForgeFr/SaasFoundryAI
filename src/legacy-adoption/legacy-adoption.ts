import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { constants, type Stats } from 'node:fs'
import { lstat, open, readdir } from 'node:fs/promises'
import { basename, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'

import { targetManifestVersion } from '../migrations/manifest/registry'
import { manifestSchemaUrl, type SaaSFoundryManifest } from '../types'
import { validateProjectName } from '../utils'
import { LEGACY_BETA_MULTIREPO_BASELINE } from './legacy-beta-baseline'

const execFileAsync = promisify(execFile)

export const LEGACY_SOURCE = {
  package: 'saasfoundry-cli',
  version: '1.0.0-beta',
  integrity: 'sha512-DDUIM7+rPrtsOCwZVjasSiUlEG7cmTelxMN0wxT0JEUffWXmwSl4mdccVdVw574RoFxydBBEn0yYto3Dtfs34A==',
  shasum: '4dd553bf5c026dfc7502e3d54f8bbc53746b6cf8'
} as const

const CRITICAL_SIGNATURES = {
  api: {
    'nest-cli.json': 'ac83151181a8e239c7f842c6b556faf863efc30fb57f549a11db7baec046469b',
    'tsconfig.json': '4129ede0672eec1e90a74ffa65cbffc3e71075addd1cf2c89fc94c8fce43982e',
    'prisma/schema/schema.prisma': '41f975ffe77d9df95f85f3b6301c2399c583bb479086a3c2ebfbf96b349acfdb'
  },
  web: {
    'components.json': '88c6da52383a1e765d5d0c3e07231a3e1fd024b7f86d26686bd40210fbbb81df',
    'tsconfig.json': '3727519fb7bc2436eea9fa91a34e05e77e89036122e1e84b9b72bb0040055c81',
    'src/main.tsx': 'df3b50410e71c81fea0650ffd2c16f560e87498fa2222c3cd003b81f89b21c53',
    'vite.config.ts': 'a0184de279b39bc2c92ba5674450a2f808770551d9a589e9d17f4eeeb85364c8'
  }
} as const

const WALK_IGNORES = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', 'logs', '.saasfoundry.agents.lock'])
const NEVER_MANAGED = new Set(['.env', '.env.test', 'package-lock.json'])
const MIN_RECOGNIZED_RATIO = 0.9
const MAILERSEND_SERVICE_SHA256 = '1eeda93431bf7cd4b2e6dfa5e900f91a1668d0c044e46c02ad4774e947fdc850'
const MAX_EVIDENCE_FILE_BYTES = 64 * 1024 * 1024
const MAX_EVIDENCE_TOTAL_BYTES = 256 * 1024 * 1024

type LegacyRole = 'api' | 'web' | 'db'

interface LegacyFileEvidence {
  hash: string
  bytes?: Buffer
}

interface EvidenceBudget {
  bytes: number
}

export type LegacyAdoptionReason =
  | 'project-name-required'
  | 'project-name-mismatch'
  | 'ambiguous-topology'
  | 'unsupported-legacy-layout'
  | 'missing-legacy-layout'
  | 'unsafe-filesystem-entry'
  | 'signature-mismatch'
  | 'main-branch-required'

export interface LegacyAdoptionReport {
  version: 1
  mutated: false
  legacyAdoption: {
    status: 'blocked' | 'would-adopt'
    reasonCode?: LegacyAdoptionReason
    message?: string
    source: typeof LEGACY_SOURCE
    topology?: 'multirepo'
    projectName?: string
    mainBranch?: string
    modules?: NonNullable<SaaSFoundryManifest['modules']>
    managedPaths?: string[]
    unmanagedPaths?: string[]
    fingerprint?: string
  }
}

export interface DetectLegacyAdoptionOptions {
  projectRoot: string
  projectName?: string
  mainBranch?: string
}

export interface LegacyAdoptionPlan {
  report: LegacyAdoptionReport
  manifest?: SaaSFoundryManifest
}

class LegacyBlocked extends Error {
  constructor(
    readonly reason: LegacyAdoptionReason,
    message: string
  ) {
    super(message)
  }
}

function normalized(path: string): string {
  return path.split(sep).join('/')
}

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function sameFile(before: Stats, after: Stats): boolean {
  return before.dev === after.dev && before.ino === after.ino && before.mode === after.mode && before.nlink === after.nlink && before.size === after.size
}

async function assertDirectory(path: string): Promise<boolean> {
  const stat = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (!stat) return false
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new LegacyBlocked('unsafe-filesystem-entry', `Expected a real directory: ${path}`)
  return true
}

/** Read evidence through a no-follow descriptor and verify it did not change. */
async function readRegularFile(path: string, retainBytes: boolean, budget: EvidenceBudget): Promise<LegacyFileEvidence> {
  const noFollow = 'O_NOFOLLOW' in constants ? constants.O_NOFOLLOW : 0
  const nonBlock = 'O_NONBLOCK' in constants ? constants.O_NONBLOCK : 0
  const handle = await open(path, constants.O_RDONLY | noFollow | nonBlock).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') throw new LegacyBlocked('signature-mismatch', `Required legacy file is missing: ${path}`)
    if (error.code === 'ELOOP') throw new LegacyBlocked('unsafe-filesystem-entry', `Legacy evidence must not be a symbolic link: ${path}`)
    throw error
  })
  try {
    const before = await handle.stat()
    if (!before.isFile() || before.nlink !== 1) throw new LegacyBlocked('unsafe-filesystem-entry', `Legacy evidence must be a regular, non-linked file: ${path}`)
    if (before.size > MAX_EVIDENCE_FILE_BYTES) throw new LegacyBlocked('unsafe-filesystem-entry', `Legacy evidence exceeds the ${MAX_EVIDENCE_FILE_BYTES}-byte per-file inspection limit: ${path}`)
    if (budget.bytes + before.size > MAX_EVIDENCE_TOTAL_BYTES) {
      throw new LegacyBlocked('unsafe-filesystem-entry', `The legacy project exceeds the ${MAX_EVIDENCE_TOTAL_BYTES}-byte inspection limit.`)
    }
    budget.bytes += before.size
    let bytes: Buffer | undefined
    let hash: string
    if (retainBytes) {
      bytes = await handle.readFile()
      hash = sha256(bytes)
    } else {
      const digest = createHash('sha256')
      const stream = handle.createReadStream({ autoClose: false })
      for await (const chunk of stream) digest.update(chunk as Buffer)
      hash = digest.digest('hex')
    }
    const after = await handle.stat()
    if (!sameFile(before, after)) throw new LegacyBlocked('unsafe-filesystem-entry', `Legacy evidence changed while it was being read: ${path}`)
    return { hash, ...(bytes ? { bytes } : {}) }
  } finally {
    await handle.close()
  }
}

async function walkProjectFiles(
  root: string,
  projectRoot: string,
  files: Map<string, LegacyFileEvidence>,
  seenCase: Map<string, string>,
  retainPaths: Set<string>,
  budget: EvidenceBudget
): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    if (WALK_IGNORES.has(entry.name)) continue
    const absolute = join(root, entry.name)
    const path = normalized(relative(projectRoot, absolute))
    const folded = path.normalize('NFC').toLocaleLowerCase('en-US')
    const previous = seenCase.get(folded)
    if (previous && previous !== path) throw new LegacyBlocked('unsafe-filesystem-entry', `Case-colliding paths are not safe to adopt: ${previous}, ${path}`)
    seenCase.set(folded, path)
    const stat = await lstat(absolute)
    if (stat.isSymbolicLink()) throw new LegacyBlocked('unsafe-filesystem-entry', `Unsupported filesystem entry: ${path}`)
    if (stat.isDirectory()) await walkProjectFiles(absolute, projectRoot, files, seenCase, retainPaths, budget)
    else {
      if (!stat.isFile() || stat.nlink !== 1) throw new LegacyBlocked('unsafe-filesystem-entry', `Unsupported filesystem entry: ${path}`)
      files.set(path, await readRegularFile(absolute, retainPaths.has(path), budget))
    }
    if (files.size > 20_000) throw new LegacyBlocked('unsafe-filesystem-entry', 'The legacy project contains too many files to inspect safely.')
  }
}

function normalizePackage(bytes: Buffer, projectName: string, role: 'api' | 'web'): Buffer | undefined {
  try {
    const pkg = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>
    const repository = pkg.repository as Record<string, unknown> | undefined
    // The published beta accidentally applied the API package identity to both
    // multirepo apps. Adoption recognizes that exact historical output.
    const expectedKeywords = [projectName, 'saasfoundry', 'backend', 'nest', 'prisma']
    if (
      pkg.name !== `${projectName}-api` ||
      typeof pkg.description !== 'string' ||
      !repository ||
      typeof repository.url !== 'string' ||
      JSON.stringify(pkg.keywords) !== JSON.stringify(expectedKeywords)
    )
      return undefined
    pkg.name = role === 'api' ? 'saasfoundry-api' : 'saasfoundry-web'
    pkg.description = role === 'api' ? 'Backend API for SaaSFoundry' : 'SaaSFoundry: Our new SaaS frontend application'
    repository.url = role === 'api' ? 'https://github.com/agachet/saasfoundry/apps/api' : 'https://github.com/agachet/saasfoundry/apps/web'
    pkg.keywords = role === 'api' ? ['saasfoundry', 'open-source', 'backend', 'nest', 'prisma'] : ['saasfoundry', 'open-source', 'frontend', 'react', 'tailwindcss']
    return Buffer.from(`${JSON.stringify(pkg, null, 2)}\n`)
  } catch {
    return undefined
  }
}

function matchesGeneratedVariant(role: LegacyRole, path: string, bytes: Buffer, expectedHash: string, projectName: string): boolean {
  if ((role === 'api' || role === 'web') && path === 'package.json') {
    const normalizedPackage = normalizePackage(bytes, projectName, role)
    return Boolean(normalizedPackage && sha256(normalizedPackage) === expectedHash)
  }

  let content = bytes.toString('utf8')
  if (role === 'api' && (path === 'src/modules/email/locales/en.ts' || path === 'src/modules/email/locales/fr.ts')) {
    content = content.replaceAll(projectName.toUpperCase(), 'SaaSFoundry')
  } else if ((role === 'api' || role === 'web') && path === 'docker-compose.yml') {
    content = content.replaceAll(`${projectName}-network`, 'saasfoundry-network').replaceAll(`${projectName}-${role}`, `saasfoundry-${role}`)
  } else if ((role === 'api' || role === 'web') && path === '.github/workflows/deployment.yml') {
    content = content.replaceAll(`${projectName}-network`, 'saasfoundry-network')
  } else {
    return false
  }
  return sha256(content) === expectedHash
}

function assertCriticalSignatures(files: Map<string, LegacyFileEvidence>, roots: Record<'api' | 'web', string>): void {
  for (const role of ['api', 'web'] as const) {
    for (const [path, expected] of Object.entries(CRITICAL_SIGNATURES[role])) {
      const fullPath = `${roots[role]}/${path}`
      const evidence = files.get(fullPath)
      if (!evidence || evidence.hash !== expected) throw new LegacyBlocked('signature-mismatch', `Legacy signature mismatch: ${fullPath}`)
    }
  }
}

function classifyCandidate(
  files: Map<string, LegacyFileEvidence>,
  roots: Partial<Record<LegacyRole, string>>,
  projectName: string
): { managedPaths: string[]; unmanagedPaths: string[]; fileHashes: Record<string, string> } {
  const candidatePaths = new Set<string>()
  const managedPaths: string[] = []
  const unmanagedPaths: string[] = []
  const fileHashes: Record<string, string> = {}
  let recognized = 0
  let eligible = 0

  for (const role of ['api', 'web', 'db'] as const) {
    const root = roots[role]
    if (!root) continue
    for (const [path, expectedHash] of Object.entries(LEGACY_BETA_MULTIREPO_BASELINE[role])) {
      const fullPath = `${root}/${path}`
      candidatePaths.add(fullPath)
      const evidence = files.get(fullPath)
      if (!evidence?.bytes) throw new LegacyBlocked('signature-mismatch', `The published beta inventory requires ${fullPath}.`)
      const bytes = evidence.bytes
      if (NEVER_MANAGED.has(basename(path))) {
        unmanagedPaths.push(fullPath)
        continue
      }
      eligible += 1
      if (evidence.hash === expectedHash || matchesGeneratedVariant(role, path, bytes, expectedHash, projectName)) {
        recognized += 1
        managedPaths.push(fullPath)
        fileHashes[fullPath] = evidence.hash
      } else {
        unmanagedPaths.push(fullPath)
      }
    }
  }

  if (recognized / eligible < MIN_RECOGNIZED_RATIO) {
    throw new LegacyBlocked(
      'signature-mismatch',
      `Only ${recognized}/${eligible} historical template files match the verified npm release; adoption requires at least ${Math.ceil(eligible * MIN_RECOGNIZED_RATIO)}.`
    )
  }
  for (const path of files.keys()) if (!candidatePaths.has(path)) unmanagedPaths.push(path)
  return { managedPaths: managedPaths.sort(), unmanagedPaths: [...new Set(unmanagedPaths)].sort(), fileHashes }
}

async function inferBranch(paths: string[]): Promise<string | undefined> {
  const branches: string[] = []
  for (const cwd of paths) {
    try {
      const { stdout } = await execFileAsync('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd })
      if (stdout.trim()) branches.push(stdout.trim())
    } catch {
      // A local-only project may not have Git metadata. The caller then has to
      // provide --main-branch explicitly rather than accepting a guess.
    }
  }
  return branches.length === paths.length && new Set(branches).size === 1 ? branches[0] : undefined
}

function inferModules(files: Map<string, LegacyFileEvidence>, roots: { api: string; db?: string }): NonNullable<SaaSFoundryManifest['modules']> {
  const mailerPath = `${roots.api}/src/modules/email/services/mailersend.service.ts`
  const mailer = files.get(mailerPath)
  if (mailer && mailer.hash !== MAILERSEND_SERVICE_SHA256) throw new LegacyBlocked('signature-mismatch', `Legacy MailerSend signature mismatch: ${mailerPath}`)
  let dbSetup: 'docker' | 'credentials' | 'manual' = roots.db ? 'docker' : 'manual'
  if (!roots.db) {
    const env = files.get(`${roots.api}/.env`)?.bytes?.toString('utf8') ?? ''
    if (/^DATABASE_URL="[^"]+"/m.test(env) && /^DIRECT_URL="[^"]+"/m.test(env)) dbSetup = 'credentials'
  }
  return {
    email: { provider: mailer ? 'mailersend' : 'none', version: 1 },
    s3Setup: 'manual',
    dbSetup,
    includeAnalytics: false,
    advancedSkills: [],
    // The published beta deposited a few core AI files inside each generated
    // application, but it did not install or manage the project-root
    // collaboration harness. Record that distinction explicitly so capability
    // classification sees an adopted project as the supported stack profile
    // and `sf update --target-profile full` can add the managed harness. Leaving
    // this absent means "legacy unknown" and correctly blocks the transition.
    harness: { version: 1, managed: false }
  }
}

function fingerprintPlan(value: unknown): string {
  return sha256(JSON.stringify(value))
}

export async function detectLegacyAdoption(options: DetectLegacyAdoptionOptions): Promise<LegacyAdoptionPlan> {
  const projectRoot = resolve(options.projectRoot)
  const blocked = (reasonCode: LegacyAdoptionReason, message: string): LegacyAdoptionPlan => ({
    report: { version: 1, mutated: false, legacyAdoption: { status: 'blocked', reasonCode, message, source: LEGACY_SOURCE } }
  })
  try {
    await assertDirectory(projectRoot)
    const rootName = basename(projectRoot)
    const projectName = options.projectName ?? rootName
    try {
      validateProjectName(projectName)
    } catch {
      throw new LegacyBlocked('project-name-required', 'Provide the original generated project name with --project-name.')
    }
    if (options.projectName && rootName !== options.projectName) {
      throw new LegacyBlocked('project-name-mismatch', `The project directory (${rootName}) must match --project-name (${options.projectName}).`)
    }

    const monoApi = join(projectRoot, 'apps/api')
    const monoWeb = join(projectRoot, 'apps/web')
    const multiApi = join(projectRoot, `apps/${projectName}-api`)
    const multiWeb = join(projectRoot, `apps/${projectName}-web`)
    const [hasMonoApi, hasMonoWeb, hasMultiApi, hasMultiWeb] = await Promise.all([assertDirectory(monoApi), assertDirectory(monoWeb), assertDirectory(multiApi), assertDirectory(multiWeb)])
    if (hasMonoApi !== hasMonoWeb || hasMultiApi !== hasMultiWeb) throw new LegacyBlocked('ambiguous-topology', 'A partial legacy API/web topology is present.')
    if (hasMonoApi && hasMultiApi) throw new LegacyBlocked('ambiguous-topology', 'Both monorepo and multirepo legacy layouts are present.')
    if (hasMonoApi && hasMonoWeb) {
      throw new LegacyBlocked('unsupported-legacy-layout', 'The verified 1.0.0-beta release disabled monorepo generation, so an apps/api + apps/web layout cannot be adopted as its output.')
    }
    if (!hasMultiApi || !hasMultiWeb) throw new LegacyBlocked('missing-legacy-layout', 'No complete SaaSFoundry beta multirepo API/web layout was found.')

    const apiRoot = multiApi
    const webRoot = multiWeb
    const dbRootCandidate = join(projectRoot, `apps/${projectName}-db`)
    const dbRoot = (await assertDirectory(dbRootCandidate)) ? dbRootCandidate : undefined
    const relativeRoots = {
      api: normalized(relative(projectRoot, apiRoot)),
      web: normalized(relative(projectRoot, webRoot)),
      ...(dbRoot ? { db: normalized(relative(projectRoot, dbRoot)) } : {})
    }
    const files = new Map<string, LegacyFileEvidence>()
    const seenCase = new Map<string, string>()
    const retainPaths = new Set<string>()
    for (const role of ['api', 'web', 'db'] as const) {
      const root = relativeRoots[role]
      if (root) for (const path of Object.keys(LEGACY_BETA_MULTIREPO_BASELINE[role])) retainPaths.add(`${root}/${path}`)
    }
    const budget = { bytes: 0 }
    // Inventory the whole project. Only verified historical template paths can
    // become managed; root files, sibling apps and custom artifacts remain
    // explicitly unmanaged across later hash refreshes.
    await walkProjectFiles(projectRoot, projectRoot, files, seenCase, retainPaths, budget)

    assertCriticalSignatures(files, relativeRoots)
    const { managedPaths, unmanagedPaths, fileHashes } = classifyCandidate(files, relativeRoots, projectName)
    const modules = inferModules(files, { api: relativeRoots.api, db: relativeRoots.db })
    const inferredBranch = await inferBranch([apiRoot, webRoot])
    if (options.mainBranch && inferredBranch && options.mainBranch !== inferredBranch) {
      throw new LegacyBlocked('main-branch-required', `--main-branch ${options.mainBranch} contradicts the legacy repositories, which both use ${inferredBranch}.`)
    }
    const mainBranch = options.mainBranch ?? inferredBranch
    if (!mainBranch || !/^[A-Za-z0-9._/-]+$/.test(mainBranch) || mainBranch.startsWith('-') || mainBranch.includes('..')) {
      throw new LegacyBlocked('main-branch-required', 'The API and web Git branches do not agree. Provide --main-branch explicitly.')
    }

    const evidence = [...files.entries()].map(([path, entry]) => [path, entry.hash] as const).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    const stablePlan = { source: LEGACY_SOURCE, topology: 'multirepo', projectName, mainBranch, modules, managedPaths, unmanagedPaths, evidence }
    const fingerprint = fingerprintPlan(stablePlan)
    const manifest: SaaSFoundryManifest = {
      $schema: manifestSchemaUrl,
      manifestVersion: targetManifestVersion(),
      version: LEGACY_SOURCE.version,
      generatedAt: new Date().toISOString(),
      structure: 'multirepo',
      projectName,
      mainBranch,
      ports: { db: 5435, api: 3500, web: 5173 },
      modules,
      fileHashes,
      unmanagedPaths,
      adoption: {
        kind: 'legacy',
        sourcePackage: LEGACY_SOURCE.package,
        sourceVersion: LEGACY_SOURCE.version,
        sourceIntegrity: LEGACY_SOURCE.integrity,
        layout: 'multirepo',
        planFingerprint: fingerprint,
        refreshPending: true
      }
    }
    return {
      report: {
        version: 1,
        mutated: false,
        legacyAdoption: { status: 'would-adopt', source: LEGACY_SOURCE, topology: 'multirepo', projectName, mainBranch, modules, managedPaths, unmanagedPaths, fingerprint }
      },
      manifest
    }
  } catch (error) {
    if (error instanceof LegacyBlocked) return blocked(error.reason, error.message)
    throw error
  }
}
