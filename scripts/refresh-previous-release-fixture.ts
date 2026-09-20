#!/usr/bin/env node

/**
 * Manual refresh tool for the immutable saasfoundry-cli@1.0.0-beta fixture.
 *
 * This script is deliberately absent from package.json scripts and refuses CI.
 * It either consumes the exact local npm tarball or downloads that exact version
 * after an explicit --allow-network acknowledgement. It never resolves a tag or
 * a semver range.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { constants } from 'node:fs'
import { chmod, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, relative, resolve, sep } from 'node:path'
import { gzipSync } from 'node:zlib'
import { format, resolveConfig } from 'prettier'

import { DEFAULT_LEGACY_FIXTURE_LIMITS, parseLegacyReleaseFixture } from '../tests/docker/legacy-release-fixture'

const SOURCE = {
  package: 'saasfoundry-cli',
  version: '1.0.0-beta',
  integrity: 'sha512-DDUIM7+rPrtsOCwZVjasSiUlEG7cmTelxMN0wxT0JEUffWXmwSl4mdccVdVw574RoFxydBBEn0yYto3Dtfs34A==',
  shasum: '4dd553bf5c026dfc7502e3d54f8bbc53746b6cf8',
  gitHead: '1a682d7ecfa76edcc20af0604da962b06a9c92a7',
  archiveSha256: 'b1abb454495a6a0732f3187beb94298a2c3c79d5f98c376949c577736a1c633b'
} as const

const GENERATION_INPUTS = {
  projectName: 'previous-release',
  projectDescription: 'Immutable SaaSFoundry previous-release fixture',
  mainBranch: 'main',
  isMonorepo: false,
  setupRepo: 'local',
  dbSetup: 'manual',
  emailService: 'none'
} as const

const FIXTURE_DIR = resolve('tests/docker/fixtures/previous-release/1.0.0-beta')
const FIXTURE_FILE = 'multirepo.fixture.json.gz'
const METADATA_FILE = 'multirepo.metadata.json'
const INVENTORY_FILE = 'multirepo.files.sha256'
const TRANSCRIPT_FILE = 'multirepo.transcript.txt'
const ARTIFACT_FILES = [FIXTURE_FILE, METADATA_FILE, INVENTORY_FILE, TRANSCRIPT_FILE] as const
const MAX_SOURCE_TARBALL_BYTES = 16 * 1024 * 1024
const INHERITED_ENVIRONMENT = ['PATH', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'COMSPEC', 'PATHEXT', 'SHELL'] as const

interface Args {
  tarball?: string
  packageVersion?: string
  allowNetwork: boolean
  outputDir: string
}

interface FixtureEntry {
  path: string
  type: 'file'
  mode: 420 | 493
  size: number
  sha256: string
  contentBase64: string
}

interface ContentRewrite {
  path: string
  beforeSha256: string
  beforeSha256Scope: string
  afterSha256: string
  reason: string
}

function usage(): never {
  throw new Error(
    [
      'Usage:',
      '  npx tsx scripts/refresh-previous-release-fixture.ts --tarball /absolute/path/saasfoundry-cli-1.0.0-beta.tgz --allow-network',
      '  npx tsx scripts/refresh-previous-release-fixture.ts --package-version 1.0.0-beta --allow-network',
      '',
      '--allow-network is mandatory because the published generator installs its runtime and generated-project dependencies.',
      'This command is manual provenance maintenance and refuses to run when CI is set.'
    ].join('\n')
  )
}

function parseArgs(argv: string[]): Args {
  const result: Args = { allowNetwork: false, outputDir: FIXTURE_DIR }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--allow-network') result.allowNetwork = true
    else if (arg === '--tarball') result.tarball = argv[++index]
    else if (arg === '--package-version') result.packageVersion = argv[++index]
    else if (arg === '--output-dir') result.outputDir = resolve(argv[++index])
    else usage()
  }
  if (Boolean(result.tarball) === Boolean(result.packageVersion)) usage()
  if (result.packageVersion && result.packageVersion !== SOURCE.version) throw new Error(`Only the exact published version ${SOURCE.version} is accepted.`)
  if (!result.allowNetwork) throw new Error('--allow-network is required explicitly; the beta generator runs npm install.')
  return result
}

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function sha1(bytes: Buffer): string {
  return createHash('sha1').update(bytes).digest('hex')
}

function sha512Integrity(bytes: Buffer): string {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`
}

function normalized(path: string): string {
  return path.split(sep).join('/')
}

function byteOrder(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right))
}

function redactDiagnostics(value: string, env: NodeJS.ProcessEnv): string {
  let redacted = value.slice(-16 * 1024)
  for (const [name, secret] of Object.entries(env)) {
    if (secret && /(?:TOKEN|KEY|SECRET|PASSWORD|AUTH|COOKIE)/i.test(name)) redacted = redacted.replaceAll(secret, '<redacted>')
  }
  return redacted.replace(/((?:authorization|cookie|token|api[_-]?key|secret|password)\s*[:=]\s*)[^\s,;]+/gi, '$1<redacted>')
}

function run(command: string, args: string[], options: { cwd?: string; env: NodeJS.ProcessEnv }): string {
  try {
    return execFileSync(command, args, {
      cwd: options.cwd,
      env: options.env,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe']
    })
  } catch (error) {
    const detail = error as { stdout?: Buffer | string; stderr?: Buffer | string }
    throw new Error(`${command} failed.\nstdout:\n${redactDiagnostics(String(detail.stdout ?? ''), options.env)}\nstderr:\n${redactDiagnostics(String(detail.stderr ?? ''), options.env)}`)
  }
}

async function createSterileEnvironment(tempRoot: string): Promise<NodeJS.ProcessEnv> {
  const home = join(tempRoot, 'home')
  await mkdir(home, { mode: 0o700 })
  const npmrc = join(home, '.npmrc')
  await writeFile(npmrc, '', { flag: 'wx', mode: 0o600 })
  const inherited = Object.fromEntries(INHERITED_ENVIRONMENT.flatMap((name) => (process.env[name] === undefined ? [] : [[name, process.env[name]]])))
  return {
    ...inherited,
    HOME: home,
    USERPROFILE: home,
    npm_config_userconfig: npmrc,
    NPM_CONFIG_USERCONFIG: npmrc,
    npm_config_ignore_scripts: 'true',
    NPM_CONFIG_IGNORE_SCRIPTS: 'true',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    HUSKY: '0',
    CI: 'false',
    NO_COLOR: '1',
    FORCE_COLOR: '0'
  }
}

async function readStableRegularFile(path: string, maximumBytes: number, label: string): Promise<Buffer> {
  const noFollow = 'O_NOFOLLOW' in constants ? constants.O_NOFOLLOW : 0
  const handle = await open(path, constants.O_RDONLY | noFollow)
  try {
    const before = await handle.stat()
    if (!before.isFile() || before.nlink !== 1) throw new Error(`${label} must be one regular, non-linked file.`)
    if (before.size > maximumBytes) throw new Error(`${label} exceeds the ${maximumBytes}-byte safety limit.`)
    const bytes = await handle.readFile()
    const after = await handle.stat()
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
      throw new Error(`${label} changed while it was read.`)
    }
    return bytes
  } finally {
    await handle.close()
  }
}

async function acquireTarball(args: Args, tempRoot: string, env: NodeJS.ProcessEnv): Promise<string> {
  if (args.tarball) {
    const path = await realpath(resolve(args.tarball))
    const sourceStat = await lstat(path)
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink() || sourceStat.nlink !== 1) throw new Error('The source tarball must be one regular, non-linked file.')
    return path
  }

  const downloadDir = join(tempRoot, 'download')
  await mkdir(downloadDir, { recursive: true })
  const packed = JSON.parse(run('npm', ['pack', `${SOURCE.package}@${SOURCE.version}`, '--json', '--pack-destination', downloadDir], { env })) as Array<{ filename?: string }>
  if (packed.length !== 1 || !packed[0].filename) throw new Error('npm pack did not return exactly one tarball.')
  return join(downloadDir, packed[0].filename)
}

async function verifySourceTarball(path: string): Promise<Buffer> {
  const bytes = await readStableRegularFile(path, MAX_SOURCE_TARBALL_BYTES, 'The source tarball')
  const observed = { integrity: sha512Integrity(bytes), shasum: sha1(bytes), archiveSha256: sha256(bytes) }
  for (const key of Object.keys(observed) as Array<keyof typeof observed>) {
    if (observed[key] !== SOURCE[key]) throw new Error(`Source tarball ${key} mismatch: expected ${SOURCE[key]}, received ${observed[key]}.`)
  }
  return bytes
}

async function installPublishedPackage(tarball: string, tempRoot: string, env: NodeJS.ProcessEnv): Promise<string> {
  if (process.platform === 'win32') throw new Error('Fixture refresh requires a POSIX host or container with tar; normal fixture verification remains cross-platform.')
  const unpacked = join(tempRoot, 'published-package')
  await mkdir(unpacked, { recursive: true })
  run('tar', ['-xzf', tarball, '-C', unpacked], { env })
  const packageRoot = join(unpacked, 'package')
  const packageJson = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as { name?: string; version?: string }
  if (packageJson.name !== SOURCE.package || packageJson.version !== SOURCE.version) throw new Error('The verified tarball package identity is inconsistent.')
  run('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: packageRoot,
    env: { ...env, npm_config_loglevel: 'error' }
  })
  return packageRoot
}

async function generateProject(packageRoot: string, tempRoot: string, baseEnv: NodeJS.ProcessEnv): Promise<{ projectRoot: string; transcript: string }> {
  const workspace = join(tempRoot, 'generation-workspace')
  await mkdir(workspace, { recursive: true })
  const driver = join(tempRoot, 'capture-beta-generator.cjs')
  await writeFile(
    driver,
    [
      "const path = require('node:path')",
      'const packageRoot = process.argv[2]',
      'const workspace = process.argv[3]',
      `const answers = ${JSON.stringify(GENERATION_INPUTS)}`,
      "const inquirer = require(require.resolve('inquirer', { paths: [packageRoot] }))",
      'let primaryPromptSeen = false',
      'inquirer.prompt = async (questions) => {',
      '  const names = questions.map((question) => question.name)',
      "  if (names.includes('projectName') && !primaryPromptSeen) { primaryPromptSeen = true; return { ...answers } }",
      "  throw new Error(`Unexpected beta prompt during deterministic capture: ${names.join(', ')}`)",
      '}',
      'process.chdir(workspace)',
      "const { newCommand } = require(path.join(packageRoot, 'dist/commands/new.js'))",
      'Promise.resolve(newCommand()).then(() => {',
      "  if (!primaryPromptSeen) throw new Error('The published beta prompt was not exercised.')",
      '}).catch((error) => { console.error(error); process.exitCode = 1 })',
      ''
    ].join('\n')
  )

  const fixedGitDate = '2000-01-01T00:00:00Z'
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    TZ: 'UTC',
    LANG: 'C.UTF-8',
    npm_config_loglevel: 'error',
    GIT_AUTHOR_NAME: 'SaaSFoundry Fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'SaaSFoundry Fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    GIT_AUTHOR_DATE: fixedGitDate,
    GIT_COMMITTER_DATE: fixedGitDate
  }
  const transcript = run(process.execPath, [driver, packageRoot, workspace], { cwd: workspace, env })
  const projectRoot = join(workspace, GENERATION_INPUTS.projectName)
  if (!(await stat(projectRoot)).isDirectory()) throw new Error(`The published generator did not create ${GENERATION_INPUTS.projectName}.`)
  return { projectRoot, transcript }
}

const EXCLUDED_DIRECTORY_NAMES = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', 'logs', '.cache', '.npm'])
const EXCLUDED_FILE_NAMES = new Set(['.DS_Store', 'npm-debug.log', 'yarn-error.log'])

async function sanitizeGeneratedSecrets(projectRoot: string): Promise<ContentRewrite[]> {
  const envPath = join(projectRoot, 'apps', `${GENERATION_INPUTS.projectName}-api`, '.env')
  const before = await readStableRegularFile(envPath, DEFAULT_LEGACY_FIXTURE_LIMITS.maxEntryBytes, 'Generated API environment file')
  let content = before.toString('utf8')
  let redactedBefore = content
  const sentinels: Record<string, string> = {
    JWT_SECRET_AUTH: 'fixture_only_not_a_secret_auth_000000000000000000000000',
    JWT_SECRET_REFRESH: 'fixture_only_not_a_secret_refresh_00000000000000000000',
    JWT_SECRET_INVITATION: 'fixture_only_not_a_secret_invitation_000000000000000000',
    JWT_SECRET_CONFIRM_ACCOUNT: 'fixture_only_not_a_secret_confirm_00000000000000000000',
    JWT_SECRET_RESET_PASSWORD: 'fixture_only_not_a_secret_reset_000000000000000000000'
  }
  for (const [key, value] of Object.entries(sentinels)) {
    const pattern = new RegExp(`^${key}="[0-9a-f]{128}"$`, 'm')
    if (!pattern.test(content)) throw new Error(`The published generator no longer emitted the expected random ${key} value.`)
    redactedBefore = redactedBefore.replace(pattern, `${key}="<generated-random-secret>"`)
    content = content.replace(pattern, `${key}="${value}"`)
  }
  const after = Buffer.from(content)
  await writeFile(envPath, after)
  return [
    {
      path: normalized(relative(projectRoot, envPath)),
      beforeSha256: sha256(redactedBefore),
      beforeSha256Scope: 'SHA-256 after replacing each generated 128-hex secret with <generated-random-secret>; raw random secret hashes are intentionally not persisted.',
      afterSha256: sha256(after),
      reason: 'The published generator creates five random JWT secrets. Fixed, non-secret fixture sentinels make the source archive deterministic and safe to commit.'
    }
  ]
}

async function collectEntries(projectRoot: string): Promise<{ entries: FixtureEntry[]; removed: string[] }> {
  const entries: FixtureEntry[] = []
  const removed: string[] = []
  let totalBytes = 0

  const walk = async (directory: string): Promise<void> => {
    const children = await readdir(directory, { withFileTypes: true })
    children.sort((left, right) => byteOrder(left.name, right.name))
    for (const child of children) {
      const absolute = join(directory, child.name)
      const path = normalized(relative(projectRoot, absolute))
      const info = await lstat(absolute)
      if (info.isDirectory() && EXCLUDED_DIRECTORY_NAMES.has(child.name)) {
        removed.push(`${path}/`)
        continue
      }
      if (info.isFile() && EXCLUDED_FILE_NAMES.has(child.name)) {
        removed.push(path)
        continue
      }
      if (info.isDirectory()) {
        await walk(absolute)
        continue
      }
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error(`Unsupported generated filesystem entry: ${path}`)
      if (Buffer.byteLength(path, 'utf8') > DEFAULT_LEGACY_FIXTURE_LIMITS.maxPathBytes) throw new Error(`Generated fixture path exceeds the portable limit: ${path}`)
      const content = await readStableRegularFile(absolute, DEFAULT_LEGACY_FIXTURE_LIMITS.maxEntryBytes, `Generated fixture entry ${path}`)
      totalBytes += content.length
      if (totalBytes > DEFAULT_LEGACY_FIXTURE_LIMITS.maxAggregateBytes) throw new Error('Generated fixture exceeds the aggregate byte safety limit.')
      if (entries.length >= DEFAULT_LEGACY_FIXTURE_LIMITS.maxEntries) throw new Error('Generated fixture exceeds the entry-count safety limit.')
      const mode: 420 | 493 = (info.mode & 0o111) === 0 ? 420 : 493
      entries.push({ path, type: 'file', mode, size: content.length, sha256: sha256(content), contentBase64: content.toString('base64') })
    }
  }

  await walk(projectRoot)
  entries.sort((left, right) => byteOrder(left.path, right.path))
  removed.sort(byteOrder)
  return { entries, removed }
}

function treeDigest(entries: FixtureEntry[]): string {
  const digest = createHash('sha256')
  for (const entry of entries) digest.update(`${entry.path}\0${entry.mode}\0${entry.size}\0${entry.sha256}\n`)
  return digest.digest('hex')
}

function inventory(entries: FixtureEntry[]): string {
  return `${entries.map((entry) => `${entry.sha256}  ${entry.mode.toString(8)}  ${entry.size}  ${entry.path}`).join('\n')}\n`
}

async function publishArtifactSet(outputDir: string, artifacts: ReadonlyMap<string, Buffer | string>): Promise<void> {
  await mkdir(outputDir, { recursive: true })
  const outputStat = await lstat(outputDir)
  if (!outputStat.isDirectory() || outputStat.isSymbolicLink()) throw new Error('Fixture output must be a real directory.')
  const parent = await realpath(join(outputDir, '..'))
  const staging = await mkdtemp(join(parent, '.sf-fixture-artifacts-stage-'))
  const backup = await mkdtemp(join(parent, '.sf-fixture-artifacts-backup-'))
  const published: string[] = []
  const backedUp: string[] = []

  try {
    for (const [name, bytes] of artifacts) await writeFile(join(staging, name), bytes, { flag: 'wx', mode: 0o600 })
    await chmod(join(staging, FIXTURE_FILE), 0o644)

    const stagedFixture = await readFile(join(staging, FIXTURE_FILE))
    const parsed = parseLegacyReleaseFixture(stagedFixture)
    const stagedMetadata = JSON.parse(await readFile(join(staging, METADATA_FILE), 'utf8')) as { fixture?: { sha256?: string; treeSha256?: string } }
    if (stagedMetadata.fixture?.sha256 !== sha256(stagedFixture) || stagedMetadata.fixture.treeSha256 !== parsed.canonicalDigest) {
      throw new Error('Refusing to publish an internally inconsistent fixture artifact set.')
    }

    for (const name of ARTIFACT_FILES) {
      const destination = join(outputDir, name)
      const exists = await lstat(destination).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined
        throw error
      })
      if (exists) {
        if (!exists.isFile() || exists.isSymbolicLink() || exists.nlink !== 1) throw new Error(`Refusing to replace unsafe fixture artifact: ${name}`)
        await rename(destination, join(backup, name))
        backedUp.push(name)
      }
      await rename(join(staging, name), destination)
      published.push(name)
    }
  } catch (error) {
    for (const name of published.reverse()) await rm(join(outputDir, name), { force: true })
    for (const name of backedUp.reverse()) await rename(join(backup, name), join(outputDir, name))
    throw error
  } finally {
    await Promise.all([rm(staging, { recursive: true, force: true }), rm(backup, { recursive: true, force: true })])
  }
}

async function writeArtifacts(args: Args, sourceTarball: string, projectRoot: string, transcript: string, env: NodeJS.ProcessEnv): Promise<void> {
  const contentRewrites = await sanitizeGeneratedSecrets(projectRoot)
  const { entries, removed } = await collectEntries(projectRoot)
  if (entries.length === 0) throw new Error('Refusing to write an empty fixture.')
  const canonicalTreeSha256 = treeDigest(entries)
  const bundle = { schemaVersion: 1, source: SOURCE, generationInputs: GENERATION_INPUTS, treeSha256: canonicalTreeSha256, entries }
  const fixtureBytes = gzipSync(Buffer.from(`${JSON.stringify(bundle)}\n`), { level: 9 })
  const totalBytes = entries.reduce((total, entry) => total + entry.size, 0)
  const metadata = {
    schemaVersion: 1,
    fixture: {
      file: FIXTURE_FILE,
      sha256: sha256(fixtureBytes),
      compressedBytes: fixtureBytes.length,
      entryCount: entries.length,
      totalBytes,
      executableEntries: entries.filter((entry) => entry.mode === 493).length,
      treeSha256: canonicalTreeSha256
    },
    source: {
      ...SOURCE,
      tarballFile: basename(sourceTarball),
      npmSpec: `${SOURCE.package}@${SOURCE.version}`
    },
    capture: {
      method: 'published-newCommand-with-recorded-inquirer-answers',
      publishedCliWasInteractive: true,
      captureUsedPty: false,
      commanderWrapperBehavior: 'The published bin only dispatches sf new to newCommand; the capture invokes that exact published export with the recorded prompt answers.',
      platform: `${process.platform}-${process.arch}`,
      node: process.version,
      npm: run('npm', ['--version'], { env }).trim(),
      timezone: 'UTC',
      locale: 'C.UTF-8'
    },
    generationInputs: GENERATION_INPUTS,
    sanitization: {
      policy: 'generated-artifact-removal-and-explicit-secret-sentinel-rewrite',
      removed,
      retainedPublishedCacheCanaries: ['apps/previous-release-web/playwright-report/index.html', 'apps/previous-release-web/test-results/.last-run.json'],
      retainedPublishedCacheReason: 'These files shipped in the published scaffold and are required by the verified legacy-adoption inventory.',
      contentRewrites
    },
    limitations: {
      supportedTopology: 'multirepo',
      monorepo: 'The published beta disabled monorepo in its prompt. No authentic beta monorepo fixture exists.'
    }
  }

  const metadataPath = join(args.outputDir, METADATA_FILE)
  const prettierConfig = (await resolveConfig(metadataPath)) ?? {}
  const metadataJson = await format(JSON.stringify(metadata), { ...prettierConfig, filepath: metadataPath })
  await publishArtifactSet(
    args.outputDir,
    new Map<string, Buffer | string>([
      [FIXTURE_FILE, fixtureBytes],
      [METADATA_FILE, metadataJson],
      [INVENTORY_FILE, inventory(entries)],
      [
        TRANSCRIPT_FILE,
        [
          `source: ${SOURCE.package}@${SOURCE.version}`,
          'capture: published newCommand with deterministic Inquirer answers',
          `generationInputs: ${JSON.stringify(GENERATION_INPUTS)}`,
          '',
          transcript.trim(),
          ''
        ].join('\n')
      ]
    ])
  )
  console.log(`Wrote ${entries.length} files (${totalBytes} bytes) to ${join(args.outputDir, FIXTURE_FILE)}`)
  console.log(`Fixture SHA-256: ${metadata.fixture.sha256}`)
  console.log(`Tree SHA-256:    ${metadata.fixture.treeSha256}`)
}

async function main(): Promise<void> {
  if (process.env.CI && process.env.CI !== 'false') throw new Error('Fixture refresh is a manual provenance operation and must not run in CI.')
  const args = parseArgs(process.argv.slice(2))
  const tempRoot = await mkdtemp(join(tmpdir(), 'sf-previous-release-refresh-'))
  try {
    const env = await createSterileEnvironment(tempRoot)
    const tarball = await acquireTarball(args, tempRoot, env)
    await verifySourceTarball(tarball)
    const packageRoot = await installPublishedPackage(tarball, tempRoot, env)
    const generated = await generateProject(packageRoot, tempRoot, env)
    await writeArtifacts(args, tarball, generated.projectRoot, generated.transcript, env)
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
