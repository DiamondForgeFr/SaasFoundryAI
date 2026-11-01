import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { collectInstructionDiagnostics, compareVersions, findShadowingFiles, importsOf, measureCodexInstructions, readClaudeCodeVersion } from '../../../status/instruction-diagnostics'

let base: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'sf-instructions-'))
})

afterEach(() => {
  rmSync(base, { recursive: true, force: true })
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

  function stubClaude(output: string): void {
    const bin = join(base, 'bin')
    write(join(bin, 'claude'), `#!/bin/sh\necho '${output}'\n`)
    chmodSync(join(bin, 'claude'), 0o755)
    process.env.PATH = `${bin}:/usr/bin:/bin`
  }

  it('reads the version the local binary prints', async () => {
    stubClaude('2.1.200 (Claude Code)')
    await expect(readClaudeCodeVersion(base)).resolves.toEqual({ version: '2.1.200' })
  })

  it('names why no version was read', async () => {
    stubClaude('unexpected')
    await expect(readClaudeCodeVersion(base)).resolves.toEqual({ reason: '`claude --version` printed no version' })
    process.env.PATH = join(base, 'empty')
    await expect(readClaudeCodeVersion(base)).resolves.toEqual({ reason: '`claude` not found on PATH' })
  })
})

describe('compareVersions', () => {
  it('orders x.y.z numerically', () => {
    expect(compareVersions('2.1.276', '2.1.277')).toBeLessThan(0)
    expect(compareVersions('2.1.277', '2.1.277')).toBe(0)
    expect(compareVersions('2.10.0', '2.9.999')).toBeGreaterThan(0)
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
})
