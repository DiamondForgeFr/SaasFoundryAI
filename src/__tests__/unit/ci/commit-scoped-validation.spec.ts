import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const SCRIPT = path.resolve(__dirname, '../../../../scripts/commit-scoped-validation.mjs')

interface Plan {
  escalated: string[]
  commands: string[][]
}

/** The planner is an ES module; Jest runs CommonJS, so ask Node directly. */
function planFor(files: string[]): Plan {
  const source = `import { planScopedValidation } from ${JSON.stringify(SCRIPT)}; process.stdout.write(JSON.stringify(planScopedValidation(${JSON.stringify(files)})))`
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8' }))
}

describe('scoped commit validation planner (#878)', () => {
  it.each([
    'package.json',
    'package-lock.json',
    'tsconfig.build.json',
    'jest.config.js',
    'eslint.config.mjs',
    '.prettierrc',
    '.husky/pre-commit',
    '.github/workflows/test.yml',
    '.saasfoundry/validation.commit.json',
    'scaffolds/shared/validation/impact-classifier.mjs',
    'scripts/commit-scoped-validation.mjs'
  ])('escalates %s to the full commit check', (file) => {
    expect(planFor(['src/utils.ts', file])).toEqual({ escalated: [file], commands: [['npm', 'run', 'test:commit:full']] })
  })

  it('formats, lints and type-checks the touched files, then runs only their related tests', () => {
    const plan = planFor(['src/utils.ts', 'src/__tests__/unit/utils.spec.ts', 'docs/guide/updating-projects.md'])

    expect(plan.escalated).toEqual([])
    expect(plan.commands).toEqual([
      ['npx', 'prettier', '--check', '--ignore-path', '.prettierignore', '--ignore-unknown', 'src/utils.ts', 'src/__tests__/unit/utils.spec.ts', 'docs/guide/updating-projects.md'],
      ['npx', 'eslint', '--config', 'eslint.config.mjs', '--no-warn-ignored', 'src/utils.ts', 'src/__tests__/unit/utils.spec.ts'],
      ['npx', 'tsc', '--noEmit', '-p', '.'],
      ['npx', 'jest', '--passWithNoTests', '--findRelatedTests', 'src/utils.ts', 'src/__tests__/unit/utils.spec.ts']
    ])
  })

  it('still type-checks a commit with no source file, and runs no Jest at all', () => {
    expect(planFor(['scaffolds/overlays/monorepo/root/gitignore']).commands).toEqual([['npx', 'tsc', '--noEmit', '-p', '.']])
  })
})

describe('scoped commit validation run (#878)', () => {
  let repo: string
  let shims: string
  let log: string

  const shim = (name: string) => {
    writeFileSync(path.join(shims, name), `#!/bin/sh\necho "${name} $*" >> "${log}"\ncase "$*" in *"$FAIL_ON"*) [ -n "$FAIL_ON" ] && exit 3 ;; esac\nexit 0\n`)
    chmodSync(path.join(shims, name), 0o755)
  }
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })
  const commitFile = (file: string, content: string) => {
    mkdirSync(path.dirname(path.join(repo, file)), { recursive: true })
    writeFileSync(path.join(repo, file), content)
    git('add', file)
    git('-c', 'user.email=t@example.invalid', '-c', 'user.name=t', 'commit', '-qm', `change ${file}`)
  }
  const runScript = (failOn = '') => spawnSync(process.execPath, [SCRIPT], { cwd: repo, encoding: 'utf8', env: { ...process.env, PATH: `${shims}:${process.env.PATH}`, FAIL_ON: failOn } })
  const calls = () =>
    readFileSync(log, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split(' ').slice(0, 2).join(' '))

  beforeEach(() => {
    const root = mkdtempSync(path.join(tmpdir(), 'sf-scoped-commit-'))
    repo = path.join(root, 'repo')
    shims = path.join(root, 'bin')
    log = path.join(root, 'calls.log')
    mkdirSync(repo)
    mkdirSync(shims)
    writeFileSync(log, '')
    shim('npx')
    shim('npm')
    git('init', '-q')
    commitFile('README.md', 'base\n')
  })

  afterEach(() => rmSync(path.dirname(repo), { recursive: true, force: true }))

  it('checks only the last commit, which is the staged change in the hook worktree', () => {
    commitFile('src/utils.ts', 'export const a = 1\n')

    const result = runScript()

    expect(result.status).toBe(0)
    expect(calls()).toEqual(['npx prettier', 'npx eslint', 'npx tsc', 'npx jest'])
    expect(readFileSync(log, 'utf8')).toContain('--findRelatedTests src/utils.ts')
    expect(readFileSync(log, 'utf8')).not.toContain('README.md')
  })

  it('stops at the first failing check and reports its status', () => {
    commitFile('src/utils.ts', 'export const a = 1\n')

    const result = runScript('eslint')

    expect(result.status).toBe(3)
    expect(calls()).toEqual(['npx prettier', 'npx eslint'])
  })

  it('escalates to the full commit check when the staged range cannot be read', () => {
    rmSync(path.join(repo, '.git'), { recursive: true, force: true })
    execFileSync('git', ['init', '-q'], { cwd: repo })

    const result = runScript()

    expect(result.status).toBe(0)
    expect(calls()).toEqual(['npm run'])
    expect(readFileSync(log, 'utf8')).toContain('npm run test:commit:full')
  })
})
