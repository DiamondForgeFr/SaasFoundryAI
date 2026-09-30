import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../../../..')
const RUNNER = path.join(ROOT, 'scaffolds/shared/validation/run-impact-validation.mjs')
const COMMIT_CONFIG = path.join(ROOT, '.saasfoundry/validation.commit.json')
const RELEASE_CONFIG = path.join(ROOT, '.saasfoundry/validation.json')

interface ValidationConfig {
  version: number
  profile: string
  commands: Record<string, string[][]>
}

function readConfig(file: string): ValidationConfig {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function scriptClosure(name: string, scripts: Record<string, string>, seen = new Set<string>()): string {
  if (seen.has(name)) return ''
  seen.add(name)
  const source = scripts[name]
  if (!source) throw new Error(`Missing validation script: ${name}`)
  const children = [...source.matchAll(/npm run ([\w:-]+)/g)].map((match) => scriptClosure(match[1], scripts, seen))
  if (/\bnpm test\b/.test(source)) children.push(scriptClosure('test', scripts, seen))
  return [source, ...children].join('\n')
}

describe('contributor commit validation', () => {
  let fixture: string
  let base: string

  beforeEach(() => {
    fixture = mkdtempSync(path.join(tmpdir(), 'sf-commit-validation-'))
    execFileSync('git', ['init', '-q'], { cwd: fixture })
    execFileSync('git', ['config', 'user.email', 'tests@example.com'], { cwd: fixture })
    execFileSync('git', ['config', 'user.name', 'Tests'], { cwd: fixture })
    writeFileSync(path.join(fixture, 'README.md'), 'base\n')
    execFileSync('git', ['add', 'README.md'], { cwd: fixture })
    execFileSync('git', ['commit', '-qm', 'base'], { cwd: fixture })
    base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fixture, encoding: 'utf8' }).trim()
  })

  afterEach(() => rmSync(fixture, { recursive: true, force: true }))

  function plan(file: string, config = COMMIT_CONFIG, rangeBase = base): string {
    mkdirSync(path.dirname(path.join(fixture, file)), { recursive: true })
    writeFileSync(path.join(fixture, file), 'changed\n')
    execFileSync('git', ['add', file], { cwd: fixture })
    execFileSync('git', ['commit', '-qm', 'change'], { cwd: fixture })
    return execFileSync('node', [RUNNER, '--base', rangeBase, '--head', 'HEAD', '--config', config, '--dry-run'], { cwd: fixture, encoding: 'utf8' })
  }

  it('routes the hook to a separate mapping without weakening release validation', () => {
    const scripts = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts as Record<string, string>
    expect(readFileSync(path.join(ROOT, '.husky/pre-commit'), 'utf8')).toContain('npm run test:staged')
    expect(scripts['test:staged']).toContain('--config .saasfoundry/validation.commit.json')
    expect(scripts['test:impact']).toContain('--config .saasfoundry/validation.json')
    expect(scripts['test:pre-push']).toBe('npm run test:docker:normal')
    expect(scripts['test:full']).toContain('npm run test:docker:full')
    expect(readConfig(RELEASE_CONFIG).commands.lifecycle).toEqual([['npm', 'run', 'test:docker:normal']])
    expect(readConfig(RELEASE_CONFIG).commands.full).toEqual([['npm', 'run', 'test:full']])

    const config = readConfig(COMMIT_CONFIG)
    expect(config).toMatchObject({ version: 1, profile: 'saasfoundry' })
    expect(Object.keys(config.commands)).toEqual(Object.keys(readConfig(RELEASE_CONFIG).commands))
    for (const commands of Object.values(config.commands)) {
      for (const command of commands) {
        expect(command.slice(0, 2)).toEqual(['npm', 'run'])
        expect(command).toHaveLength(3)
        expect(scriptClosure(command[2], scripts)).not.toMatch(/docker|test:pre-push|--if-present|\|\| true/)
      }
    }
    expect(scripts['test:commit:full']).toBe('npm run format:check && npm run lint && npm run build && npm run package:check && npm test')
    expect(readFileSync(path.join(ROOT, '.github/CODEOWNERS'), 'utf8')).toContain('/.saasfoundry/validation.commit.json @AGachet')
  })

  it('keeps docs-only checks selective', () => {
    const output = plan('README.md')
    expect(output).toContain('> npm run test:impact:guards')
    expect(output).toContain('> npm run test:impact:docs')
    expect(output).not.toContain('> npm run test:commit:full')
  })

  it.each(['src/commands/fixture.ts', 'package.json', 'unknown.contract'])('retains a non-Docker full fallback for %s', (file) => {
    const output = plan(file)
    expect(output).toContain('> npm run test:commit:full')
    expect(output).not.toContain('> npm run test:full\n')
    expect(output).not.toContain('test:docker')
  })

  it('fails wide to non-Docker checks when the Git range is unavailable', () => {
    expect(plan('README.md', COMMIT_CONFIG, 'missing-base')).toContain('> npm run test:commit:full')
  })

  it('deduplicates guard checks for lifecycle-only changes instead of launching Docker', () => {
    const output = plan('Dockerfile.test')
    expect(output).toContain('- RUN lifecycle')
    expect(output.match(/> npm run test:impact:guards/g)).toHaveLength(1)
    expect(output).not.toContain('test:docker')
  })

  it('keeps explicit release validation heavy', () => {
    expect(plan('package.json', RELEASE_CONFIG)).toContain('> npm run test:full')
  })

  it('rejects bad staged content even when an unstaged fix exists', () => {
    writeFileSync(
      path.join(fixture, 'package.json'),
      JSON.stringify({
        scripts: {
          'test:commit:full': `node -e "if(require('fs').readFileSync('README.md','utf8')!=='fixed\\n')process.exit(42)"`
        }
      })
    )
    writeFileSync(path.join(fixture, 'README.md'), 'bad staged content\n')
    execFileSync('git', ['add', 'package.json', 'README.md'], { cwd: fixture })
    writeFileSync(path.join(fixture, 'README.md'), 'fixed\n')

    const result = spawnSync('node', [RUNNER, '--staged', '--config', COMMIT_CONFIG], { cwd: fixture, encoding: 'utf8' })
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('npm exited with status 42')
    expect(readFileSync(path.join(fixture, 'README.md'), 'utf8')).toBe('fixed\n')
  })
})
