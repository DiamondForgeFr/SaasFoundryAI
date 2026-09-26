import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(__dirname, '../../../..')
const CLASSIFIER = path.join(ROOT, 'scaffolds/shared/validation/impact-classifier.mjs')
const RUNNER = path.join(ROOT, 'scaffolds/shared/validation/run-impact-validation.mjs')

interface Classification {
  mode: string
  full: boolean
  fallback: { code: string } | null
  changedFiles: Array<{ status: string; oldPath: string | null; path: string }>
  lanes: Record<string, { run: boolean; reasons: Array<{ code: string; paths: string[] }> }>
  plan: Record<string, boolean | string>
}

function classify(profile: string, changes: unknown[], extra: Record<string, unknown> = {}): Classification {
  const source = `
    import { classifyChanges } from ${JSON.stringify(pathToFileURL(CLASSIFIER).href)};
    const input = JSON.parse(process.env.SF_CLASSIFIER_INPUT);
    process.stdout.write(JSON.stringify(classifyChanges(input)));
  `
  return JSON.parse(
    execFileSync('node', ['--input-type=module', '--eval', source], {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        SF_CLASSIFIER_INPUT: JSON.stringify({ profile, base: 'base', head: 'head', rangeMode: 'two-dot', changes, ...extra })
      }
    })
  ) as Classification
}

function change(file: string, status = 'M', oldPath: string | null = null) {
  return { status, oldPath, path: file }
}

function validationCommands(overrides: Record<string, string[][]> = {}): Record<string, string[][]> {
  return {
    guards: [['npm', 'run', 'guard']],
    docs: [['npm', 'run', 'docs']],
    frontend: [['npm', 'run', 'frontend']],
    backend: [['npm', 'run', 'backend']],
    shared: [['npm', 'run', 'shared']],
    harnessScaffold: [['npm', 'run', 'harness']],
    lifecycle: [['npm', 'run', 'lifecycle']],
    full: [['npm', 'run', 'full']],
    ...overrides
  }
}

function initRepository(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'sf-impact-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 'tests@example.com'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 'Tests'], { cwd: dir })
  return dir
}

function commitAll(dir: string, message: string): string {
  execFileSync('git', ['add', '--all'], { cwd: dir })
  execFileSync('git', ['commit', '-qm', message], { cwd: dir })
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()
}

describe('impact classifier path contract', () => {
  it('keeps a real documentation-only change lightweight', () => {
    const result = classify('saasfoundry', [change('docs/guide/validation.md')])
    expect(result.full).toBe(false)
    expect(result.lanes.guards.run).toBe(true)
    expect(result.lanes.docs.run).toBe(true)
    expect(result.lanes.frontend.run).toBe(false)
    expect(result.lanes.backend.run).toBe(false)
    expect(result.lanes.lifecycle.run).toBe(false)
  })

  it.each([
    ['scaffolds/blueprints/api/src/main.ts', 'backend'],
    ['scaffolds/blueprints/web/src/main.tsx', 'frontend']
  ])('fans generated %s changes into the product lifecycle', (file, lane) => {
    const result = classify('saasfoundry', [change(file)])
    expect(result.lanes[lane].run).toBe(true)
    expect(result.lanes.harnessScaffold.run).toBe(true)
    expect(result.lanes.lifecycle.run).toBe(true)
  })

  it('does not misclassify documentation deposited into a generated scaffold as repository docs-only', () => {
    const result = classify('saasfoundry', [change('scaffolds/docs/manifest-schema.md')])
    expect(result.lanes.docs.run).toBe(false)
    expect(result.lanes.harnessScaffold.run).toBe(true)
    expect(result.lanes.lifecycle.run).toBe(true)
  })

  it('fans monorepo shared packages into API and Web validation', () => {
    const result = classify('monorepo', [change('packages/shared-validation/src/auth.ts')])
    expect(result.lanes.shared.run).toBe(true)
    expect(result.lanes.backend.run).toBe(true)
    expect(result.lanes.frontend.run).toBe(true)
    expect(result.lanes.lifecycle.run).toBe(true)
    expect(result.full).toBe(false)
    expect(result.plan.frontend).toBe(false)
    expect(result.plan.backend).toBe(false)
    expect(result.plan.shared).toBeUndefined()
  })

  it('does not turn a confident union of selective lanes into release-grade full validation', () => {
    const result = classify('monorepo', [change('README.md'), change('packages/shared-types/src/user.ts'), change('AGENTS.md')])
    expect(result.mode).toBe('selective')
    expect(result.full).toBe(false)
    expect(result.lanes.docs.run).toBe(true)
    expect(result.lanes.shared.run).toBe(true)
    expect(result.lanes.harnessScaffold.run).toBe(true)
    expect(result.lanes.lifecycle.run).toBe(true)
  })

  it.each([
    ['api', 'src/modules/accounts/account.service.ts', 'backend', 'frontend'],
    ['web', 'src/pages/dashboard.tsx', 'frontend', 'backend']
  ])('limits the %s full profile to applicable product lanes', (profile, file, expected, absent) => {
    const result = classify(profile, [change(file)])
    expect(result.lanes[expected].run).toBe(true)
    expect(result.lanes[absent].run).toBe(false)
  })

  it.each(['package-lock.json', '.github/workflows/test.yml', 'scripts/saasfoundry/impact-classifier.mjs', 'unknown.bin'])('fails wide for %s', (file) => {
    const result = classify('monorepo', [change(file)])
    expect(result.full).toBe(true)
    expect(result.lanes.frontend.run).toBe(true)
    expect(result.lanes.backend.run).toBe(true)
    expect(result.lanes.lifecycle.run).toBe(true)
  })

  it('unions both sides of a cross-lane rename', () => {
    const result = classify('monorepo', [change('apps/web/src/user.ts', 'R100', 'apps/api/src/user.ts')])
    expect(result.lanes.backend.run).toBe(true)
    expect(result.lanes.frontend.run).toBe(true)
  })

  it('turns unsupported statuses and unsafe paths into a full fallback', () => {
    for (const candidate of [change('src/value.ts', 'T'), change('../outside.ts')]) {
      const result = classify('web', [candidate])
      expect(result.mode).toBe('fallback-full')
      expect(result.fallback).not.toBeNull()
      expect(result.lanes.frontend.run).toBe(true)
    }
  })

  it('defers execution without losing the computed impact explanation', () => {
    const result = classify('saasfoundry', [change('docs/index.md')], { deferred: true })
    expect(result.mode).toBe('deferred')
    expect(result.lanes.docs.run).toBe(true)
    expect(result.plan.docs).toBe(false)
    expect(result.plan.guards).toBe(false)
  })
})

describe('impact classifier Git adapter and outputs', () => {
  let dir: string
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('parses spaces, deletion and cross-lane rename from an explicit range', () => {
    dir = initRepository()
    writeFileSync(path.join(dir, 'old file.ts'), 'old\n')
    writeFileSync(path.join(dir, 'deleted.ts'), 'delete\n')
    const base = commitAll(dir, 'base')
    execFileSync('mkdir', ['-p', path.join(dir, 'apps/web/src')])
    execFileSync('git', ['mv', 'old file.ts', 'apps/web/src/new file.ts'], { cwd: dir })
    rmSync(path.join(dir, 'deleted.ts'))
    const head = commitAll(dir, 'head')

    const result = JSON.parse(execFileSync('node', [CLASSIFIER, '--profile', 'monorepo', '--base', base, '--head', head, '--format', 'json'], { cwd: dir, encoding: 'utf8' })) as Classification
    expect(result.changedFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'D', path: 'deleted.ts' }),
        expect.objectContaining({ status: expect.stringMatching(/^R/), oldPath: 'old file.ts', path: 'apps/web/src/new file.ts' })
      ])
    )
    expect(result.full).toBe(true)
  })

  it('falls back to full when an explicit endpoint cannot be resolved', () => {
    dir = initRepository()
    writeFileSync(path.join(dir, 'README.md'), 'base\n')
    const head = commitAll(dir, 'base')
    const result = JSON.parse(execFileSync('node', [CLASSIFIER, '--profile', 'api', '--base', 'missing', '--head', head, '--format', 'json'], { cwd: dir, encoding: 'utf8' })) as Classification
    expect(result.mode).toBe('fallback-full')
    expect(result.fallback?.code).toBe('RANGE_UNAVAILABLE_FULL')
    expect(result.lanes.backend.run).toBe(true)
  })

  it('writes strict single-line GitHub outputs', () => {
    dir = initRepository()
    writeFileSync(path.join(dir, 'README.md'), 'base\n')
    const base = commitAll(dir, 'base')
    writeFileSync(path.join(dir, 'README.md'), 'changed\n')
    const head = commitAll(dir, 'head')
    const output = path.join(dir, 'github-output')
    execFileSync('node', [CLASSIFIER, '--profile', 'api', '--base', base, '--head', head, '--format', 'json', '--github-output', output], { cwd: dir })
    const entries = Object.fromEntries(
      readFileSync(output, 'utf8')
        .trim()
        .split('\n')
        .map((line) => line.split('='))
    )
    expect(entries).toMatchObject({ contract_version: '1', execute: 'true', full: 'false', docs: 'true', backend: 'false', lifecycle: 'false' })
  })

  it('rejects malformed CLI integration instead of reporting a false success', () => {
    const result = spawnSync('node', [CLASSIFIER, '--profile', 'invalid', '--base', 'a', '--head', 'b'], { cwd: ROOT, encoding: 'utf8' })
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('--profile must be one of')
  })

  it('uses the same classification contract to build a deduplicated local command plan', () => {
    dir = initRepository()
    writeFileSync(path.join(dir, 'README.md'), 'base\n')
    const base = commitAll(dir, 'base')
    writeFileSync(path.join(dir, 'README.md'), 'changed\n')
    const head = commitAll(dir, 'head')
    const config = path.join(dir, 'validation.json')
    writeFileSync(
      config,
      JSON.stringify({
        version: 1,
        profile: 'api',
        commands: validationCommands({
          docs: [
            ['npm', 'run', 'guard'],
            ['npm', 'run', 'docs']
          ]
        })
      })
    )
    const output = execFileSync('node', [RUNNER, '--base', base, '--head', head, '--config', config, '--dry-run'], { cwd: dir, encoding: 'utf8' })
    expect(output.match(/> npm run guard/g)).toHaveLength(1)
    expect(output).toContain('> npm run docs')
    expect(output).not.toContain('> npm run full')

    const full = execFileSync('node', [RUNNER, '--base', head, '--head', head, '--config', config, '--full', '--dry-run'], { cwd: dir, encoding: 'utf8' })
    expect(full).toContain('> npm run full')
    expect(full).not.toContain('> npm run docs')
  })

  it('classifies the staged tree without including unstaged edits', () => {
    dir = initRepository()
    writeFileSync(path.join(dir, 'README.md'), 'base\n')
    writeFileSync(path.join(dir, 'source.ts'), 'base\n')
    commitAll(dir, 'base')
    writeFileSync(path.join(dir, 'README.md'), 'staged docs\n')
    execFileSync('git', ['add', 'README.md'], { cwd: dir })
    writeFileSync(path.join(dir, 'source.ts'), 'unstaged source\n')
    const config = path.join(dir, 'validation.json')
    writeFileSync(
      config,
      JSON.stringify({
        version: 1,
        profile: 'web',
        commands: validationCommands()
      })
    )

    const output = execFileSync('node', [RUNNER, '--staged', '--config', config, '--dry-run'], { cwd: dir, encoding: 'utf8' })
    expect(output).toContain('Staged tree: HEAD..')
    expect(output).toContain('> npm run guard')
    expect(output).toContain('> npm run docs')
    expect(output).not.toContain('> npm run frontend')
    expect(output).not.toContain('> npm run full')
  })

  it('uses the configured full command whenever classification expands to every lane', () => {
    dir = initRepository()
    writeFileSync(path.join(dir, 'README.md'), 'base\n')
    const base = commitAll(dir, 'base')
    writeFileSync(path.join(dir, 'package.json'), '{}\n')
    const head = commitAll(dir, 'root contract')
    const config = path.join(dir, 'validation.json')
    writeFileSync(
      config,
      JSON.stringify({
        version: 1,
        profile: 'monorepo',
        commands: validationCommands()
      })
    )

    const output = execFileSync('node', [RUNNER, '--base', base, '--head', head, '--config', config, '--dry-run'], { cwd: dir, encoding: 'utf8' })
    expect(output).toContain('> npm run full')
    expect(output).not.toContain('> npm run guard')
    expect(output).not.toContain('> npm run lifecycle')
  })

  it('rejects missing command lanes instead of passing a full fallback with no work', () => {
    dir = initRepository()
    writeFileSync(path.join(dir, 'README.md'), 'base\n')
    const head = commitAll(dir, 'base')
    const config = path.join(dir, 'validation.json')
    writeFileSync(config, JSON.stringify({ version: 1, profile: 'web', commands: {} }))

    const result = spawnSync('node', [RUNNER, '--base', head, '--head', head, '--config', config, '--full', '--dry-run'], { cwd: dir, encoding: 'utf8' })
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Invalid impact-validation command lanes')
  })

  it('rejects option-like npm script names that could turn validation into a no-op', () => {
    dir = initRepository()
    writeFileSync(path.join(dir, 'README.md'), 'base\n')
    const head = commitAll(dir, 'base')
    const config = path.join(dir, 'validation.json')
    writeFileSync(config, JSON.stringify({ version: 1, profile: 'web', commands: validationCommands({ full: [['npm', 'run', '--if-present']] }) }))

    const result = spawnSync('node', [RUNNER, '--base', head, '--head', head, '--config', config, '--full', '--dry-run'], { cwd: dir, encoding: 'utf8' })
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Invalid command list for lane full')
  })

  it('executes staged validation in the staged snapshot, not against unstaged fixes', () => {
    dir = initRepository()
    writeFileSync(path.join(dir, 'README.md'), 'base\n')
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({
        scripts: Object.fromEntries(
          ['guard', 'docs', 'frontend', 'backend', 'shared', 'harness', 'lifecycle', 'full'].map((name) => [
            name,
            `node -e "const fs=require('fs');if(fs.readFileSync('README.md','utf8')!=='staged\\n')process.exit(1)"`
          ])
        )
      })
    )
    writeFileSync(path.join(dir, 'validation.json'), JSON.stringify({ version: 1, profile: 'web', commands: validationCommands() }))
    commitAll(dir, 'base')
    writeFileSync(path.join(dir, 'README.md'), 'staged\n')
    execFileSync('git', ['add', 'README.md'], { cwd: dir })
    writeFileSync(path.join(dir, 'README.md'), 'unstaged fix\n')

    const result = spawnSync('node', [RUNNER, '--staged', '--config', path.join(dir, 'validation.json')], { cwd: dir, encoding: 'utf8' })
    expect(result.status).toBe(0)
    expect(readFileSync(path.join(dir, 'README.md'), 'utf8')).toBe('unstaged fix\n')
  })
})
