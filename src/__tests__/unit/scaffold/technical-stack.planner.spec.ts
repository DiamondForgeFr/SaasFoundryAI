import { chmod, link, lstat, mkdir, mkdtemp, readFile, readlink, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  normalizePortableRelativePath,
  planTechnicalStackAdoption,
  technicalStackDryRunReport,
  technicalOwnershipHashes,
  type TechnicalStackAdoptionPlan
} from '../../../scaffold/technical-stack.planner'

async function put(root: string, path: string, content: string | Buffer): Promise<void> {
  const target = join(root, ...path.split('/'))
  await mkdir(join(target, '..'), { recursive: true })
  await writeFile(target, content)
}

async function tree(root: string): Promise<unknown[]> {
  const result: unknown[] = []
  async function walk(directory: string, prefix = ''): Promise<void> {
    const entries = (await readdir(directory)).sort()
    for (const name of entries) {
      const path = prefix ? `${prefix}/${name}` : name
      const absolute = join(directory, name)
      const stat = await lstat(absolute)
      if (stat.isSymbolicLink()) result.push([path, 'link', await readlink(absolute)])
      else if (stat.isDirectory()) {
        result.push([path, 'directory', stat.mode & 0o777])
        await walk(absolute, path)
      } else result.push([path, 'file', stat.mode & 0o777, (await readFile(absolute)).toString('base64')])
    }
  }
  await walk(root)
  return result
}

describe('technical stack initial-adoption planner', () => {
  let sandbox: string
  let projectRoot: string
  let candidateRoot: string

  beforeEach(async () => {
    sandbox = await mkdtemp(join(tmpdir(), 'sf-adoption-plan-'))
    projectRoot = join(sandbox, 'project')
    candidateRoot = join(sandbox, 'candidate')
    await Promise.all([mkdir(projectRoot), mkdir(candidateRoot)])
  })

  afterEach(async () => {
    await rm(sandbox, { recursive: true, force: true })
  })

  it('classifies every candidate file deterministically and never mutates either tree', async () => {
    await put(candidateRoot, 'apps/api/add.ts', 'new')
    await put(candidateRoot, 'apps/api/same.ts', 'same')
    await put(candidateRoot, 'apps/api/conflict.ts', 'candidate')
    await put(projectRoot, 'apps/api/same.ts', 'same')
    await put(projectRoot, 'apps/api/conflict.ts', 'user')
    const before = [await tree(projectRoot), await tree(candidateRoot)]

    const first = await planTechnicalStackAdoption({ projectRoot, candidateRoot, excludedPaths: [] })
    const second = await planTechnicalStackAdoption({ projectRoot, candidateRoot, excludedPaths: [] })

    expect(first).toEqual(second)
    expect(first.entries.map(({ path, action }) => ({ path, action }))).toEqual([
      { path: 'apps/api/add.ts', action: 'add' },
      { path: 'apps/api/conflict.ts', action: 'conflict' },
      { path: 'apps/api/same.ts', action: 'compatible' }
    ])
    expect(first.canApply).toBe(false)
    expect([await tree(projectRoot), await tree(candidateRoot)]).toEqual(before)
  })

  it('fails closed on candidate links, hardlinks, special names, live links and ancestor conflicts', async () => {
    await put(candidateRoot, 'safe/source.ts', 'source')
    await symlink('source.ts', join(candidateRoot, 'safe/link.ts'))
    await link(join(candidateRoot, 'safe/source.ts'), join(candidateRoot, 'safe/hard.ts'))
    await put(candidateRoot, 'CON', 'reserved')
    await put(candidateRoot, 'linked/child.ts', 'candidate')
    await put(candidateRoot, 'blocked/child.ts', 'candidate')
    await symlink('elsewhere', join(projectRoot, 'linked'))
    await put(projectRoot, 'blocked', 'not a directory')

    const plan = await planTechnicalStackAdoption({ projectRoot, candidateRoot, excludedPaths: [] })
    const byPath = Object.fromEntries(plan.entries.map((entry) => [entry.path, entry]))

    expect(byPath.CON).toMatchObject({ action: 'unsupported', reason: 'unsafe-candidate-path' })
    expect(byPath['safe/link.ts']).toMatchObject({ action: 'unsupported', reason: 'unsafe-candidate-type' })
    expect(byPath['safe/source.ts']).toMatchObject({ action: 'unsupported', reason: 'unsafe-candidate-hardlink' })
    expect(byPath['safe/hard.ts']).toMatchObject({ action: 'unsupported', reason: 'unsafe-candidate-hardlink' })
    expect(byPath['linked/child.ts']).toMatchObject({ action: 'unsupported', reason: 'ancestor-not-directory' })
    expect(byPath['blocked/child.ts']).toMatchObject({ action: 'unsupported', reason: 'ancestor-not-directory' })
  })

  it('detects portable case aliases at a touched destination and ignores unrelated names', async () => {
    await put(candidateRoot, 'apps/api/main.ts', 'candidate')
    await mkdir(join(projectRoot, 'Apps'), { recursive: true })
    await put(projectRoot, 'unrelated/Foo.ts', 'user')

    const plan = await planTechnicalStackAdoption({ projectRoot, candidateRoot, excludedPaths: [] })

    expect(plan.entries).toEqual([expect.objectContaining({ path: 'apps/api/main.ts', action: 'unsupported', reason: 'case-alias' })])
  })

  it('detects candidate directory aliases even when their leaf names differ', async () => {
    await put(candidateRoot, 'Apps/api.ts', 'one')
    await put(candidateRoot, 'apps/web.ts', 'two')

    // Case-insensitive hosts merge both directory names before the planner can
    // observe them. Linux CI exercises the portable collision guard itself.
    const rootNames = await readdir(candidateRoot)
    if (!(rootNames.includes('Apps') && rootNames.includes('apps'))) return

    const plan = await planTechnicalStackAdoption({ projectRoot, candidateRoot, excludedPaths: [] })

    expect(plan.entries).toEqual([
      expect.objectContaining({ path: 'Apps/api.ts', action: 'unsupported', reason: 'case-alias' }),
      expect.objectContaining({ path: 'apps/web.ts', action: 'unsupported', reason: 'case-alias' })
    ])
  })

  it('keeps protected candidate paths outside the technical plan and ownership baseline', async () => {
    await put(candidateRoot, 'CLAUDE.md', 'candidate instructions')
    await put(candidateRoot, '.claude/settings.json', '{}')
    await put(candidateRoot, 'apps/api/.env', 'SECRET=value')
    await put(candidateRoot, 'apps/api/package-lock.json', '{}')
    await put(candidateRoot, 'apps/api/src/main.ts', 'main')

    const plan = await planTechnicalStackAdoption({ projectRoot, candidateRoot })

    expect(plan.entries.map((entry) => entry.path)).toEqual(['apps/api/.env', 'apps/api/package-lock.json', 'apps/api/src/main.ts'])
    expect(technicalOwnershipHashes(plan)).toEqual({ 'apps/api/src/main.ts': expect.any(String) })
  })

  it.each(['../escape', '/absolute', 'C:/drive', '//server/share', 'a\\b', 'a//b', 'a/../b', 'NUL.txt', 'trailing.'])('rejects non-portable path %s', (path) => {
    expect(() => normalizePortableRelativePath(path)).toThrow('Unsafe relative path')
  })

  it('rejects overlapping roots without inspecting user content', async () => {
    const nestedCandidate = join(projectRoot, 'candidate')
    await mkdir(nestedCandidate)

    const plan: TechnicalStackAdoptionPlan = await planTechnicalStackAdoption({ projectRoot, candidateRoot: nestedCandidate, excludedPaths: [] })

    expect(plan).toMatchObject({ canApply: false, entries: [{ path: '.', action: 'unsupported', reason: 'overlapping-roots' }] })
  })

  it('records executable candidate mode without changing it during planning', async () => {
    await put(candidateRoot, 'scripts/run.sh', '#!/bin/sh\n')
    await chmod(join(candidateRoot, 'scripts/run.sh'), 0o755)

    const plan = await planTechnicalStackAdoption({ projectRoot, candidateRoot, excludedPaths: [] })

    expect(plan.entries[0].candidate?.mode).toBe(0o755)
  })

  it('reports an executable-mode mismatch as a conflict', async () => {
    await put(candidateRoot, 'scripts/run.sh', '#!/bin/sh\n')
    await put(projectRoot, 'scripts/run.sh', '#!/bin/sh\n')
    await chmod(join(candidateRoot, 'scripts/run.sh'), 0o755)
    await chmod(join(projectRoot, 'scripts/run.sh'), 0o644)

    const plan = await planTechnicalStackAdoption({ projectRoot, candidateRoot, excludedPaths: [] })

    expect(plan.entries[0]).toMatchObject({ action: 'conflict', reason: 'incompatible-mode' })
  })

  it('projects a versioned dry-run report without candidate hashes or contents', async () => {
    await put(candidateRoot, 'apps/api/.env', 'JWT_SECRET=never-report-me')
    const plan = await planTechnicalStackAdoption({ projectRoot, candidateRoot, excludedPaths: [] })

    const serialized = JSON.stringify(technicalStackDryRunReport(plan, 'monorepo'))

    expect(serialized).toContain('apps/api/.env')
    expect(serialized).not.toContain('never-report-me')
    expect(serialized).not.toContain(plan.entries[0].candidate?.sha256)
    expect(JSON.parse(serialized)).toMatchObject({ version: 1, mutated: false, topology: 'monorepo', canApply: true })
  })
})
