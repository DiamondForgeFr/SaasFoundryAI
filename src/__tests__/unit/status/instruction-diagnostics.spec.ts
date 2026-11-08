import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  collectInstructionDiagnostics,
  compareCliVersions,
  compareVersions,
  findShadowingFiles,
  findStaleClaudeMdReferences,
  importsOf,
  measureCodexInstructions,
  readClaudeCodeVersion
} from '../../../status/instruction-diagnostics'

let base: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'sf-instructions-'))
})

afterEach(() => {
  rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

function write(file: string, content: string): void {
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, content)
}

describe('findShadowingFiles', () => {
  it('reports CLAUDE.md, .claude/CLAUDE.md and CLAUDE.local.md in the project, its apps and a parent', () => {
    const project = join(base, 'workspace', 'acme')
    write(join(base, 'workspace', 'CLAUDE.md'), '# parent\n')
    write(join(project, '.claude', 'CLAUDE.md'), '# nested\n')
    write(join(project, 'CLAUDE.local.md'), '# local\n')
    write(join(project, 'apps', 'api', 'CLAUDE.md'), '# api\n')
    write(join(project, 'AGENTS.md'), '# agents\n')

    expect(findShadowingFiles(project, ['apps/api', 'apps/web'])).toEqual([
      join(project, 'apps', 'api', 'CLAUDE.md'),
      join(project, '.claude', 'CLAUDE.md'),
      join(project, 'CLAUDE.local.md'),
      join(base, 'workspace', 'CLAUDE.md')
    ])
  })

  it('finds nothing in a project that only has AGENTS.md', () => {
    write(join(base, 'AGENTS.md'), '# agents\n')
    expect(findShadowingFiles(base, [])).toEqual([])
  })
})

describe('readClaudeCodeVersion', () => {
  const originalPath = process.env.PATH

  afterEach(() => {
    process.env.PATH = originalPath
  })

  // A stub answers in milliseconds idle, but a loaded machine can take seconds to start a shell: the production bound
  // (3 s) is not what these tests check, so they give the probe a bound of their own (#1171).
  const PROBE_TIMEOUT_MS = 15_000

  function stubClaude(body: string): void {
    const bin = join(base, 'bin')
    write(join(bin, 'claude'), `#!/bin/sh\n${body}\n`)
    chmodSync(join(bin, 'claude'), 0o755)
    process.env.PATH = `${bin}:/usr/bin:/bin`
  }

  it('reads the version the local binary prints', async () => {
    stubClaude("echo '2.1.200 (Claude Code)'")
    await expect(readClaudeCodeVersion(base, PROBE_TIMEOUT_MS)).resolves.toEqual({ version: '2.1.200' })
  })

  it('names why no version was read', async () => {
    stubClaude("echo 'unexpected'")
    await expect(readClaudeCodeVersion(base, PROBE_TIMEOUT_MS)).resolves.toEqual({ reason: '`claude --version` printed no version' })
    process.env.PATH = join(base, 'empty')
    await expect(readClaudeCodeVersion(base, PROBE_TIMEOUT_MS)).resolves.toEqual({ reason: '`claude` not found on PATH' })
  })

  it('gives up on a binary that does not answer within its bound', async () => {
    // `exec` so that the timeout's signal reaches the sleep itself, which holds the output pipe.
    stubClaude('exec sleep 30')
    await expect(readClaudeCodeVersion(base, 200)).resolves.toEqual({ reason: '`claude --version` did not answer' })
  })
})

describe('compareVersions', () => {
  it('orders x.y.z numerically', () => {
    expect(compareVersions('2.1.276', '2.1.277')).toBeLessThan(0)
    expect(compareVersions('2.1.277', '2.1.277')).toBe(0)
    expect(compareVersions('2.10.0', '2.9.999')).toBeGreaterThan(0)
  })
})

describe('compareCliVersions (#1103)', () => {
  it('orders x.y.z numerically, like compareVersions', () => {
    expect(compareCliVersions('1.0.1', '1.1.0')).toBeLessThan(0)
    expect(compareCliVersions('1.1.0', '1.1.0')).toBe(0)
    expect(compareCliVersions('1.10.0', '1.9.9')).toBeGreaterThan(0)
  })

  it('reads a prerelease: older than its release, newer than the release before', () => {
    expect(compareCliVersions('1.1.0-rc.1', '1.1.0')).toBeLessThan(0)
    expect(compareCliVersions('1.1.0', '1.1.0-rc.1')).toBeGreaterThan(0)
    expect(compareCliVersions('1.1.0-rc.1', '1.0.9')).toBeGreaterThan(0)
    expect(compareCliVersions('1.0.0-beta', '1.0.0-beta')).toBe(0)
  })

  it('orders prerelease tags the way semver does', () => {
    const ordered = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0']
    for (let i = 0; i < ordered.length - 1; i++) expect(compareCliVersions(ordered[i], ordered[i + 1])).toBeLessThan(0)
  })

  it('ignores build metadata', () => {
    expect(compareCliVersions('1.1.0+abc', '1.1.0')).toBe(0)
  })

  it('answers undefined for what is not a version, where compareVersions answers NaN', () => {
    expect(compareCliVersions('1.1', '1.1.0')).toBeUndefined()
    expect(compareCliVersions('latest', '1.1.0')).toBeUndefined()
    expect(compareVersions('1.1.0-rc.1', '1.1.0')).toBeNaN()
  })
})

describe('importsOf', () => {
  it('reads @path references outside fences and inline code', () => {
    const content = 'See @docs/a.md and @./b.md.\nAlias `@modules/*` is code.\n```\n@inside/fence.md\n```\nmail me@example.com\n'
    expect(importsOf(content)).toEqual(['docs/a.md', './b.md'])
  })
})

describe('measureCodexInstructions', () => {
  it('counts every AGENTS.md from the Git root down, with imports, once each', () => {
    const project = join(base, 'acme')
    write(join(project, 'AGENTS.md'), 'root @docs/a.md @../outside.md\n')
    write(join(project, 'docs', 'a.md'), 'a @../AGENTS.md\n')
    write(join(project, 'apps', 'api', 'AGENTS.md'), 'api\n')
    write(join(base, 'outside.md'), 'x'.repeat(100))

    const sizes = measureCodexInstructions(project, ['apps/api', 'apps/web'], project)
    expect(sizes).toEqual([
      { directory: '.', bytes: 47, files: ['AGENTS.md', 'docs/a.md'] },
      { directory: 'apps/api', bytes: 51, files: ['AGENTS.md', 'docs/a.md', 'apps/api/AGENTS.md'] }
    ])
  })

  it('takes AGENTS.override.md in place of AGENTS.md, as Codex does', () => {
    write(join(base, 'AGENTS.md'), 'x'.repeat(40 * 1024))
    write(join(base, 'AGENTS.override.md'), 'short\n')
    expect(measureCodexInstructions(base, [], null)).toEqual([{ directory: '.', bytes: 6, files: ['AGENTS.override.md'] }])
  })
})

describe('collectInstructionDiagnostics', () => {
  function project(agents: string[]): void {
    write(join(base, 'AGENTS.md'), '# acme\n')
    write(
      join(base, '.saasfoundry.json'),
      JSON.stringify({ version: '1.0.1', generatedAt: '2026-10-12T00:00:00Z', projectName: 'acme', structure: 'cli', modules: { harness: { version: 4, agents } } })
    )
  }

  it('checks only what the declared agents read', async () => {
    project(['codex'])
    write(join(base, 'CLAUDE.md'), '# leftover\n')

    const diagnostics = await collectInstructionDiagnostics(base, [], null)
    expect(diagnostics.agents).toEqual(['codex'])
    expect(diagnostics.shadowing).toEqual([])
    expect(diagnostics.claudeCode).toBeUndefined()
    expect(diagnostics.codexSizes).toEqual([{ directory: '.', bytes: 7, files: ['AGENTS.md'] }])
  })

  it('diagnoses nothing where there is no instruction file', async () => {
    await expect(collectInstructionDiagnostics(base, [], null)).resolves.toEqual({ shadowing: [] })
  })

  it('reports the missing CLAUDE.md files an AGENTS.md still names (#1152)', async () => {
    project(['claude-code'])
    write(join(base, 'AGENTS.md'), '# acme\n\n- **App-specific context**: Check `apps/api/CLAUDE.md` and `apps/web/CLAUDE.md`\n')

    const diagnostics = await collectInstructionDiagnostics(base, ['apps/api', 'apps/web'], null)

    expect(diagnostics.staleReferences).toEqual([
      { file: 'AGENTS.md', line: 3, reference: 'apps/api/CLAUDE.md', target: 'apps/api/CLAUDE.md' },
      { file: 'AGENTS.md', line: 3, reference: 'apps/web/CLAUDE.md', target: 'apps/web/CLAUDE.md' }
    ])
  })
})

describe('findStaleClaudeMdReferences (#1152)', () => {
  it('reads a bare name from the directory of the AGENTS.md that holds it', () => {
    write(join(base, 'AGENTS.md'), 'tree\n│   └── CLAUDE.md     # API-specific context\n')
    write(join(base, 'apps', 'api', 'AGENTS.md'), 'Update this CLAUDE.md as the project evolves.\n')

    expect(findStaleClaudeMdReferences(base, ['apps/api', 'apps/web'])).toEqual([
      { file: 'AGENTS.md', line: 2, reference: 'CLAUDE.md', target: 'CLAUDE.md' },
      { file: 'apps/api/AGENTS.md', line: 1, reference: 'CLAUDE.md', target: 'apps/api/CLAUDE.md' }
    ])
  })

  it('does not report a CLAUDE.md that is there', () => {
    write(join(base, 'AGENTS.md'), 'Check `apps/api/CLAUDE.md`.\n')
    write(join(base, 'apps', 'api', 'CLAUDE.md'), '# api\n')

    expect(findStaleClaudeMdReferences(base, ['apps/api'])).toEqual([])
  })

  it('does not report a file it does not look for: CLAUDE.local.md, the home directory, a URL', () => {
    write(join(base, 'AGENTS.md'), 'Notes in CLAUDE.local.md, ~/.claude/CLAUDE.md, https://example.com/CLAUDE.md.\n')

    expect(findStaleClaudeMdReferences(base, [])).toEqual([])
  })

  it('does not read the heading and the comments the migration writes as references', () => {
    write(join(base, 'AGENTS.md'), '<!-- saasfoundry:migrated-from-claude-md — the sections below come from CLAUDE.md. -->\n\n## Kept from CLAUDE.md for review\n\nSome text.\n')

    expect(findStaleClaudeMdReferences(base, [])).toEqual([])
  })

  it('reports nothing where there is no AGENTS.md', () => {
    expect(findStaleClaudeMdReferences(base, ['apps/api'])).toEqual([])
  })
})
