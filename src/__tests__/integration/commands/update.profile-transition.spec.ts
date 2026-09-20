import { lstat, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { updateCommand } from '../../../commands/update'
import { classifyProjectCapabilities } from '../../../project-capabilities'
import { targetManifestVersion } from '../../../migrations/manifest/registry'
import { sha256 } from '../../../scaffold/technical-stack.planner'
import { TECHNICAL_TRANSITION_JOURNAL } from '../../../scaffold/technical-stack.transaction'
import { manifestSchemaUrl, type SaaSFoundryManifest } from '../../../types'
import { version as cliVersion } from '../../../../package.json'

jest.mock('../../../utils', () => ({
  ...jest.requireActual('../../../utils'),
  checkNodeVersion: jest.fn()
}))

jest.mock('ora', () => () => {
  const spinner: Record<string, unknown> = { text: '', succeed: jest.fn(), fail: jest.fn(), stop: jest.fn() }
  spinner.start = jest.fn(() => spinner)
  return spinner
})

const harnessManifest = (): SaaSFoundryManifest => ({
  $schema: manifestSchemaUrl,
  manifestVersion: 2,
  version: cliVersion,
  generatedAt: '2026-01-01T00:00:00.000Z',
  structure: 'cli',
  projectName: 'acme',
  mainBranch: 'main',
  workflow: { tool: 'none' },
  modules: { harness: { version: 1, managed: true }, advancedSkills: [] },
  fileHashes: {}
})

const stackManifest = (): SaaSFoundryManifest => ({
  ...harnessManifest(),
  structure: 'monorepo',
  workflow: undefined,
  modules: {
    harness: { version: 1, managed: false },
    email: { provider: 'none', version: 1 },
    s3Setup: 'manual',
    dbSetup: 'manual',
    includeAnalytics: false,
    advancedSkills: []
  }
})

describe('updateCommand profile transition', () => {
  let projectDir: string
  let originalCwd: string
  let originalExitCode: typeof process.exitCode

  beforeEach(async () => {
    projectDir = join(tmpdir(), `sf-profile-transition-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    originalCwd = process.cwd()
    originalExitCode = process.exitCode
    await mkdir(projectDir, { recursive: true })
    process.chdir(projectDir)
  })

  afterEach(async () => {
    process.exitCode = originalExitCode
    process.chdir(originalCwd)
    await rm(projectDir, { recursive: true, force: true })
    jest.restoreAllMocks()
  })

  const technicalOptions = {
    targetProfile: 'full',
    nonInteractive: true,
    projectDescription: 'Acme application',
    structure: 'monorepo' as const,
    dbSetup: 'manual' as const,
    emailService: 'none' as const,
    s3Setup: 'manual' as const,
    analytics: false,
    pwa: true
  }

  async function writeEmptyTransitionJournal(manifestBytes: Buffer, state: 'applying' | 'committed', afterBytes = Buffer.from('different-manifest')): Promise<void> {
    const root = await lstat('.', { bigint: true })
    await writeFile(
      TECHNICAL_TRANSITION_JOURNAL,
      `${JSON.stringify({
        version: 1,
        sequence: 0,
        transactionId: '00000000-0000-4000-8000-000000000001',
        planFingerprint: 'recovery-test',
        state,
        root: { dev: String(root.dev), ino: String(root.ino) },
        manifest: {
          path: '.saasfoundry.json',
          beforeSha256: state === 'committed' ? sha256(Buffer.from('before-manifest')) : sha256(manifestBytes),
          afterSha256: state === 'committed' ? sha256(manifestBytes) : sha256(afterBytes)
        },
        createdFiles: [],
        createdDirectories: [],
        plannedFiles: [],
        plannedDirectories: []
      })}\n`
    )
  }

  it('emits one versioned JSON preview and leaves a harness project byte-identical', async () => {
    const before = Buffer.from(JSON.stringify(harnessManifest(), null, 2))
    await writeFile('.saasfoundry.json', before)
    const chunks: string[] = []
    jest.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      chunks.push(String(chunk))
      return true
    }) as typeof process.stdout.write)
    jest.spyOn(console, 'error').mockImplementation(() => {})

    await updateCommand({ ...technicalOptions, dryRun: true, json: true })

    const report = JSON.parse(chunks.join(''))
    expect(report).toMatchObject({
      version: 1,
      mutated: false,
      profileTransition: { status: 'ready', targetProfile: 'full', resultCapabilities: { effectiveProfile: 'full' }, plan: { version: 1, mutated: false, topology: 'monorepo' } }
    })
    expect(await readFile('.saasfoundry.json')).toEqual(before)
    await expect(readFile('package.json')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('turns the canonical bare JSON preview into an executable structured remediation', async () => {
    await writeFile('.saasfoundry.json', JSON.stringify(harnessManifest(), null, 2))
    const chunks: string[] = []
    jest.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      chunks.push(String(chunk))
      return true
    }) as typeof process.stdout.write)
    jest.spyOn(console, 'error').mockImplementation(() => {})

    await updateCommand({ targetProfile: 'full', dryRun: true, json: true })

    expect(JSON.parse(chunks.join(''))).toMatchObject({
      version: 1,
      mutated: false,
      profileTransition: {
        status: 'blocked',
        reasonCode: 'technical-choices-required',
        remediation: [expect.objectContaining({ command: expect.stringContaining('--structure monorepo') })]
      }
    })
  })

  it('reports a blocked collision without changing the project', async () => {
    const before = Buffer.from(JSON.stringify(harnessManifest(), null, 2))
    await writeFile('.saasfoundry.json', before)
    await writeFile('package.json', '{"private":false}\n')
    const chunks: string[] = []
    jest.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      chunks.push(String(chunk))
      return true
    }) as typeof process.stdout.write)
    jest.spyOn(console, 'error').mockImplementation(() => {})

    await updateCommand({ ...technicalOptions, dryRun: true, json: true })

    const report = JSON.parse(chunks.join(''))
    expect(report.profileTransition).toMatchObject({ status: 'blocked', reasonCode: 'technical-path-conflicts', plan: { canApply: false } })
    expect(report.profileTransition.plan.paths).toContainEqual(expect.objectContaining({ path: 'package.json', action: 'conflict' }))
    expect(await readFile('.saasfoundry.json')).toEqual(before)
    expect(await readFile('package.json', 'utf8')).toBe('{"private":false}\n')
  })

  it('uses the harness addition path for a stack project preview', async () => {
    const before = Buffer.from(JSON.stringify(stackManifest(), null, 2))
    await writeFile('.saasfoundry.json', before)
    const chunks: string[] = []
    jest.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      chunks.push(String(chunk))
      return true
    }) as typeof process.stdout.write)
    jest.spyOn(console, 'error').mockImplementation(() => {})

    await updateCommand({ targetProfile: 'full', dryRun: true, json: true })

    expect(JSON.parse(chunks.join(''))).toMatchObject({
      profileTransition: { status: 'ready', currentCapabilities: { effectiveProfile: 'stack' }, resultCapabilities: { effectiveProfile: 'full' } },
      moduleAddition: { selected: ['harness'] }
    })
    expect(await readFile('.saasfoundry.json')).toEqual(before)
  })

  it('blocks a harness preview when a workflow destination is linked outside the project', async () => {
    const before = Buffer.from(JSON.stringify(stackManifest(), null, 2))
    const outside = join(tmpdir(), `sf-harness-outside-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(outside, { recursive: true })
    await writeFile('.saasfoundry.json', before)
    await symlink(outside, '.github')
    const chunks: string[] = []
    jest.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      chunks.push(String(chunk))
      return true
    }) as typeof process.stdout.write)
    jest.spyOn(console, 'error').mockImplementation(() => {})

    await updateCommand({ targetProfile: 'full', dryRun: true, json: true })

    expect(JSON.parse(chunks.join('')).profileTransition).toMatchObject({ status: 'blocked', reasonCode: 'unsafe-harness-path' })
    expect(await readFile('.saasfoundry.json')).toEqual(before)
    expect((await import('node:fs/promises')).readdir(outside)).resolves.toEqual([])
    await rm(outside, { recursive: true, force: true })
  })

  it.each(['unknown', 'inconsistent'] as const)('blocks the harness compatibility spelling when capabilities are %s', async (state) => {
    const manifest = stackManifest()
    if (state === 'unknown') {
      delete manifest.modules!.harness
    } else {
      manifest.workflow = { tool: 'none' }
    }
    const before = Buffer.from(JSON.stringify(manifest, null, 2))
    await writeFile('.saasfoundry.json', before)
    const chunks: string[] = []
    jest.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      chunks.push(String(chunk))
      return true
    }) as typeof process.stdout.write)
    jest.spyOn(console, 'error').mockImplementation(() => {})

    await updateCommand({ addModules: 'harness', dryRun: true, json: true, nonInteractive: true })

    expect(JSON.parse(chunks.join('')).profileTransition).toMatchObject({ status: 'blocked', currentCapabilities: { effectiveProfile: state } })
    expect(await readFile('.saasfoundry.json')).toEqual(before)
  })

  it('includes legacy template conflicts in a stack-to-full preview without overwriting them', async () => {
    const manifest = stackManifest()
    manifest.version = '0.9.0'
    manifest.fileHashes = { 'package.json': 'old-generated-baseline' }
    await writeFile('.saasfoundry.json', JSON.stringify(manifest, null, 2))
    await writeFile('package.json', '{"private":false,"user":"edit"}\n')
    const chunks: string[] = []
    jest.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      chunks.push(String(chunk))
      return true
    }) as typeof process.stdout.write)
    jest.spyOn(console, 'error').mockImplementation(() => {})

    await updateCommand({ targetProfile: 'full', dryRun: true, json: true, nonInteractive: true, conflictStrategy: 'replace' })

    const report = JSON.parse(chunks.join(''))
    expect(report.profileTransition).toMatchObject({ status: 'ready', currentCapabilities: { effectiveProfile: 'stack' } })
    expect(report.templateUpdate).toMatchObject({ status: 'would-apply', conflict: expect.arrayContaining(['package.json']) })
    expect(await readFile('package.json', 'utf8')).toBe('{"private":false,"user":"edit"}\n')
  })

  it('keeps stdout JSON-only for a regular update preview without a target profile', async () => {
    await writeFile('.saasfoundry.json', JSON.stringify(stackManifest(), null, 2))
    const chunks: string[] = []
    jest.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      chunks.push(String(chunk))
      return true
    }) as typeof process.stdout.write)
    jest.spyOn(console, 'error').mockImplementation(() => {})

    await updateCommand({ dryRun: true, json: true, nonInteractive: true })

    expect(JSON.parse(chunks.join(''))).toMatchObject({ version: 1, mutated: false, templateUpdate: { status: 'up-to-date' } })
    expect(chunks.join('').trimStart().startsWith('{')).toBe(true)
    expect(chunks.join('')).not.toContain('<sf-update-dry-run-report>')
  })

  it('previews credentialed modules as JSON without prompting for secrets', async () => {
    await writeFile('.saasfoundry.json', JSON.stringify(stackManifest(), null, 2))
    const chunks: string[] = []
    jest.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      chunks.push(String(chunk))
      return true
    }) as typeof process.stdout.write)
    jest.spyOn(console, 'error').mockImplementation(() => {})

    await updateCommand({ dryRun: true, json: true, addModules: 'email,analytics' })

    expect(JSON.parse(chunks.join(''))).toMatchObject({
      version: 1,
      mutated: false,
      moduleAddition: {
        selected: ['email', 'analytics'],
        email: { configured: false },
        requiredForApply: ['SF_UPDATE_MAILERSEND_API_KEY']
      }
    })
  })

  it('lists the non-secret choices and secret environment variables required by module apply', async () => {
    await writeFile('.saasfoundry.json', JSON.stringify(stackManifest(), null, 2))
    const chunks: string[] = []
    jest.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      chunks.push(String(chunk))
      return true
    }) as typeof process.stdout.write)
    jest.spyOn(console, 'error').mockImplementation(() => {})

    await updateCommand({ dryRun: true, json: true, addModules: 'storage,sf-skill-atlassian,srs' })

    const report = JSON.parse(chunks.join(''))
    expect(report.moduleAddition.storage).toBeUndefined()
    expect(report.moduleAddition.requiredForApply).toEqual(
      expect.arrayContaining(['--s3-setup', '--atlassian-email', 'SF_UPDATE_ATLASSIAN_API_TOKEN', '--atlassian-site', '--atlassian-cloud-id', 'SF_UPDATE_NOTION_API_TOKEN', '--srs-parent-page-input'])
    )
  })

  it('blocks a non-interactive apply with omitted technical choices before mutation', async () => {
    const before = Buffer.from(JSON.stringify(harnessManifest(), null, 2))
    await writeFile('.saasfoundry.json', before)
    jest.spyOn(console, 'error').mockImplementation(() => {})

    await updateCommand({ targetProfile: 'full', nonInteractive: true, dbSetup: 'manual', emailService: 'none', s3Setup: 'manual' })

    expect(process.exitCode).toBe(1)
    expect(await readFile('.saasfoundry.json')).toEqual(before)
    await expect(readFile('package.json')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('reports pending recovery in a read-only preview and keeps the recovery artifact', async () => {
    const before = Buffer.from(JSON.stringify(harnessManifest(), null, 2))
    await writeFile('.saasfoundry.json', before)
    await writeFile(TECHNICAL_TRANSITION_JOURNAL, '{"pending":true}\n')
    const chunks: string[] = []
    jest.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      chunks.push(String(chunk))
      return true
    }) as typeof process.stdout.write)
    jest.spyOn(console, 'error').mockImplementation(() => {})

    await updateCommand({ ...technicalOptions, dryRun: true, json: true })

    expect(JSON.parse(chunks.join('')).profileTransition).toMatchObject({ status: 'blocked', reasonCode: 'technical-recovery-required' })
    expect(await readFile(TECHNICAL_TRANSITION_JOURNAL, 'utf8')).toBe('{"pending":true}\n')
    expect(await readFile('.saasfoundry.json')).toEqual(before)
  })

  it('atomically adopts the technical stack and commits a full-profile manifest', async () => {
    const before = Buffer.from(JSON.stringify(harnessManifest(), null, 2))
    await writeFile('.saasfoundry.json', before)
    await writeEmptyTransitionJournal(before, 'applying')
    jest.spyOn(console, 'log').mockImplementation(() => {})

    await updateCommand(technicalOptions)

    const manifest = JSON.parse(await readFile('.saasfoundry.json', 'utf8')) as SaaSFoundryManifest
    expect(classifyProjectCapabilities(manifest).effectiveProfile).toBe('full')
    expect(manifest.structure).toBe('monorepo')
    expect(manifest.modules).toMatchObject({
      harness: { managed: true },
      email: { provider: 'none' },
      dbSetup: 'manual',
      s3Setup: 'manual',
      includeAnalytics: false
    })
    expect(await readFile('package.json', 'utf8')).toContain('"name": "acme"')
    expect(await readFile('apps/api/package.json', 'utf8')).toContain('"name": "acme-api"')
    expect(await readFile('apps/web/package.json', 'utf8')).toContain('"name": "acme-web"')
    await expect(readFile(TECHNICAL_TRANSITION_JOURNAL)).rejects.toMatchObject({ code: 'ENOENT' })
  }, 120_000)

  it('migrates a legacy harness manifest inside the atomic full-profile commit', async () => {
    const legacy = harnessManifest()
    delete legacy.modules!.harness!.managed
    await writeFile('.saasfoundry.json', JSON.stringify(legacy, null, 2))
    jest.spyOn(console, 'log').mockImplementation(() => {})

    await updateCommand(technicalOptions)

    const manifest = JSON.parse(await readFile('.saasfoundry.json', 'utf8')) as SaaSFoundryManifest & { modules: Record<string, unknown> }
    expect(manifest.manifestVersion).toBe(targetManifestVersion())
    expect(manifest.$schema).toBe(manifestSchemaUrl)
    expect(manifest.modules.harness).toMatchObject({ managed: true })
    expect(classifyProjectCapabilities(manifest).effectiveProfile).toBe('full')
  }, 120_000)

  it('cleans a committed recovery journal before returning an already-full no-op', async () => {
    const full = stackManifest()
    full.modules!.harness = { version: 1, managed: true }
    full.workflow = { tool: 'none' }
    const bytes = Buffer.from(JSON.stringify(full, null, 2))
    await writeFile('.saasfoundry.json', bytes)
    await writeEmptyTransitionJournal(bytes, 'committed')
    jest.spyOn(console, 'log').mockImplementation(() => {})

    await updateCommand({ targetProfile: 'full', nonInteractive: true })

    await expect(readFile(TECHNICAL_TRANSITION_JOURNAL)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile('.saasfoundry.json')).toEqual(bytes)
  })

  it('validates technical enums before reading a project manifest', async () => {
    await expect(updateCommand({ structure: 'monorep' as never })).rejects.toThrow(/Invalid --structure/)
  })
})
