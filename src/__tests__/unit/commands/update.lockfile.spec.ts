import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  duplicatedFrameworks,
  findLockfileRoot,
  groupByLockfileRoot,
  isPackageManifestPath,
  LOCKFILE_RESOLVE_COMMAND,
  logPendingSidecarPins,
  offerLockfileResolution,
  pinChanges,
  readPackageManifests,
  type LockfileResolutionDeps,
  type LockfileRoot
} from '../../../commands/update.lockfile'

const strip = (text: string): string => text.replace(/\u001b\[[0-9;]*m/g, '')

/** `npm ls --all --json` as npm 11 prints it after a plain install on 1.2.0's pins (#1229). */
const duplicatedTree = {
  name: 'p110',
  dependencies: {
    '@nestjs/common': { version: '11.2.1' },
    '@nestjs/jwt': { version: '11.0.2', dependencies: { '@nestjs/common': { version: '11.2.1', overridden: false } } },
    'p110-api': {
      version: '0.0.1',
      resolved: 'file:../apps/api',
      dependencies: { '@nestjs/common': { version: '11.2.8' }, '@nestjs/core': { version: '11.2.8' } }
    },
    'p110-web': {
      version: '0.0.1',
      dependencies: { react: { version: '19.3.1' }, 'react-dom': { version: '19.3.1' }, typescript: { version: '6.0.3' } }
    },
    'react-dom': { version: '19.2.5' },
    typescript: { version: '5.9.3' }
  }
}

describe('update lockfile resolution (#1229)', () => {
  describe('pinChanges', () => {
    it('lists the pins a refresh changed, added and removed, per field', () => {
      const before = JSON.stringify({ dependencies: { '@nestjs/common': '11.2.1', lodash: '4.17.21' }, devDependencies: { jest: '30.0.0' } })
      const after = JSON.stringify({ dependencies: { '@nestjs/common': '11.2.8', zod: '4.1.0' }, devDependencies: { jest: '30.0.0' } })
      expect(pinChanges('apps/api/package.json', before, after)).toEqual([
        { manifest: 'apps/api/package.json', name: '@nestjs/common', field: 'dependencies', from: '11.2.1', to: '11.2.8' },
        { manifest: 'apps/api/package.json', name: 'lodash', field: 'dependencies', from: '4.17.21' },
        { manifest: 'apps/api/package.json', name: 'zod', field: 'dependencies', to: '4.1.0' }
      ])
    })

    it('counts a changed override, which also moves the resolution', () => {
      const after = JSON.stringify({ overrides: { '@nestjs/swagger': { 'js-yaml': '5.5.0' } } })
      expect(pinChanges('package.json', '{}', after)).toEqual([{ manifest: 'package.json', name: '@nestjs/swagger', field: 'overrides', to: '{"js-yaml":"5.5.0"}' }])
    })

    it('ignores scripts and metadata, and a file it cannot parse', () => {
      expect(pinChanges('package.json', JSON.stringify({ version: '1.0.0', scripts: { a: 'x' } }), JSON.stringify({ version: '1.1.0', scripts: { a: 'y' } }))).toEqual([])
      expect(pinChanges('package.json', '{ not json', JSON.stringify({ dependencies: { react: '19.3.1' } }))).toEqual([])
    })

    it('treats an added package.json as every pin added', () => {
      expect(pinChanges('packages/x/package.json', undefined, JSON.stringify({ dependencies: { react: '19.3.1' } }))).toEqual([
        { manifest: 'packages/x/package.json', name: 'react', field: 'dependencies', to: '19.3.1' }
      ])
    })
  })

  it('recognises package.json paths, not their sidecars', () => {
    expect(isPackageManifestPath('package.json')).toBe(true)
    expect(isPackageManifestPath('apps/api/package.json')).toBe(true)
    expect(isPackageManifestPath('apps/api/package.json.saasfoundry.new')).toBe(false)
    expect(isPackageManifestPath('apps/api/not-package.json5')).toBe(false)
  })

  describe('lockfile roots', () => {
    let root: string
    beforeEach(async () => {
      root = await mkdtemp(join(tmpdir(), 'sf-lockfile-roots-'))
    })
    afterEach(async () => {
      await rm(root, { recursive: true, force: true })
    })

    it('resolves a monorepo workspace to the root lockfile', async () => {
      await mkdir(join(root, 'apps/api'), { recursive: true })
      await writeFile(join(root, 'package-lock.json'), '{}')
      expect(await findLockfileRoot(root, 'apps/api/package.json')).toBe('.')
      expect(await findLockfileRoot(root, 'package.json')).toBe('.')
    })

    it('resolves a multirepo app to its own lockfile', async () => {
      await mkdir(join(root, 'apps/acme-api'), { recursive: true })
      await writeFile(join(root, 'apps/acme-api/package-lock.json'), '{}')
      expect(await findLockfileRoot(root, 'apps/acme-api/package.json')).toBe('apps/acme-api')
    })

    it('leaves out a package.json no lockfile resolves: a first npm install resolves it fresh', async () => {
      await mkdir(join(root, 'apps/api'), { recursive: true })
      expect(await findLockfileRoot(root, 'apps/api/package.json')).toBeUndefined()
      expect(await groupByLockfileRoot(root, [{ manifest: 'apps/api/package.json', name: 'react', field: 'dependencies', from: '1', to: '2' }])).toEqual([])
    })

    it('groups the changes of every workspace under the one lockfile', async () => {
      await writeFile(join(root, 'package-lock.json'), '{}')
      const changes = [
        { manifest: 'apps/api/package.json', name: '@nestjs/common', field: 'dependencies', from: '11.2.1', to: '11.2.8' },
        { manifest: 'apps/web/package.json', name: 'react', field: 'dependencies', from: '19.2.5', to: '19.3.1' }
      ]
      expect(await groupByLockfileRoot(root, changes)).toEqual([{ root: '.', changes }])
    })

    it('reads the package.json files before the update writes them, and only those', async () => {
      await writeFile(join(root, 'package.json'), '{"a":1}')
      const contents = await readPackageManifests(root, ['package.json', 'apps/web/package.json', 'README.md'])
      expect([...contents]).toEqual([
        ['package.json', '{"a":1}'],
        ['apps/web/package.json', undefined]
      ])
    })
  })

  describe('duplicatedFrameworks', () => {
    it('reports every pinned framework installed in more than one version', () => {
      expect(duplicatedFrameworks(duplicatedTree)).toEqual([
        { name: '@nestjs/common', versions: ['11.2.1', '11.2.8'] },
        { name: 'react-dom', versions: ['19.2.5', '19.3.1'] }
      ])
    })

    it('leaves TypeScript out: the API and the web app pin different majors on purpose', () => {
      expect(duplicatedFrameworks(duplicatedTree).map(({ name }) => name)).not.toContain('typescript')
    })

    it('reports nothing for a tree with one copy of each, or for output that is not a tree', () => {
      expect(duplicatedFrameworks({ dependencies: { react: { version: '19.3.1' }, 'p110-web': { dependencies: { react: { version: '19.3.1' } } } } })).toEqual([])
      expect(duplicatedFrameworks('nope')).toEqual([])
    })
  })

  describe('offerLockfileResolution', () => {
    let lines: string[]
    let project: string
    let originalCwd: string
    const roots: LockfileRoot[] = [
      {
        root: '.',
        changes: [
          { manifest: 'apps/api/package.json', name: '@nestjs/common', field: 'dependencies', from: '11.2.1', to: '11.2.8' },
          { manifest: 'apps/web/package.json', name: 'react', field: 'dependencies', from: '19.2.5', to: '19.3.1' }
        ]
      }
    ]
    const output = () => strip(lines.join('\n'))
    const depsWith = (overrides: Partial<LockfileResolutionDeps>): LockfileResolutionDeps => ({
      refresh: jest.fn(async () => {}),
      confirm: jest.fn(async () => true),
      run: jest.fn(() => ({ code: 0, stdout: JSON.stringify({ dependencies: { react: { version: '19.3.1' } } }), stderr: '' })),
      nvmPrefix: () => 'NVM; ',
      log: (line: string) => lines.push(line),
      ...overrides
    })

    beforeEach(async () => {
      lines = []
      originalCwd = process.cwd()
      project = await mkdtemp(join(tmpdir(), 'sf-lockfile-offer-'))
      await writeFile(join(project, '.nvmrc'), '24.19.0\n')
      process.chdir(project)
    })
    afterEach(async () => {
      process.chdir(originalCwd)
      await rm(project, { recursive: true, force: true })
    })

    it('prints the command to run on a non-interactive run, and never asks nor installs', async () => {
      const deps = depsWith({})
      const results = await offerLockfileResolution(roots, { interactive: false }, deps)
      expect(results).toEqual([{ root: '.', outcome: 'non-interactive' }])
      expect(deps.confirm).not.toHaveBeenCalled()
      expect(deps.refresh).not.toHaveBeenCalled()
      expect(output()).toContain('@nestjs/common 11.2.1 → 11.2.8')
      expect(output()).toContain(`Resolve it again: ${LOCKFILE_RESOLVE_COMMAND}`)
      expect(output()).toContain('npm ls @nestjs/common @nestjs/core react react-dom @types/react @types/react-dom @prisma/client prisma --all')
      expect(output()).toContain('.nvmrc names (24.19.0')
      expect(output()).toContain('npm dedupe is not enough')
    })

    it('resolves the lockfile again when the developer accepts, under the project Node, then reports one copy each', async () => {
      const deps = depsWith({})
      const results = await offerLockfileResolution(roots, { interactive: true }, deps)
      expect(deps.refresh).toHaveBeenCalledWith('npm install (project root)', '.', 'NVM; ')
      expect(deps.run).toHaveBeenCalledWith(expect.stringMatching(/^NVM; npm ls @nestjs\/common .* --all --json$/), { cwd: '.' })
      expect(results).toEqual([{ root: '.', outcome: 'resolved', duplicates: [] }])
      expect(output()).toContain('one copy of each pinned framework is installed')
      expect(output()).not.toContain('Resolve it again:')
    })

    it('reports the frameworks still installed twice after the resolve', async () => {
      const deps = depsWith({ run: jest.fn(() => ({ code: 1, stdout: JSON.stringify(duplicatedTree), stderr: 'npm error code ELSPROBLEMS' })) })
      const [result] = await offerLockfileResolution(roots, { interactive: true }, deps)
      expect(result.duplicates).toEqual([
        { name: '@nestjs/common', versions: ['11.2.1', '11.2.8'] },
        { name: 'react-dom', versions: ['19.2.5', '19.3.1'] }
      ])
      expect(output()).toContain('! @nestjs/common: 11.2.1, 11.2.8')
    })

    it('says so when npm ls cannot be read', async () => {
      const deps = depsWith({ run: jest.fn(() => ({ code: 127, stdout: '', stderr: 'npm: not found' })) })
      const [result] = await offerLockfileResolution(roots, { interactive: true }, deps)
      expect(result).toEqual({ root: '.', outcome: 'resolved' })
      expect(output()).toContain('npm ls could not be read')
    })

    it('prints the command when the developer declines', async () => {
      const deps = depsWith({ confirm: jest.fn(async () => false) })
      const [result] = await offerLockfileResolution(roots, { interactive: true }, deps)
      expect(result.outcome).toBe('declined')
      expect(deps.refresh).not.toHaveBeenCalled()
      expect(output()).toContain(`Resolve it again: ${LOCKFILE_RESOLVE_COMMAND}`)
    })

    it('reports a failed resolve, with the command to retry', async () => {
      const deps = depsWith({
        refresh: jest.fn(async () => {
          throw new Error('npm install (project root) lock refresh failed (exit 1).')
        })
      })
      const [result] = await offerLockfileResolution(roots, { interactive: true }, deps)
      expect(result.outcome).toBe('failed')
      expect(deps.run).not.toHaveBeenCalled()
      expect(output()).toContain('the previous lockfile and node_modules are back')
      expect(output()).toContain('lock refresh failed (exit 1)')
      expect(output()).toContain(`Resolve it again: ${LOCKFILE_RESOLVE_COMMAND}`)
    })

    it('names the app directory of a multirepo lockfile in the command', async () => {
      const deps = depsWith({})
      await offerLockfileResolution([{ root: 'apps/acme-api', changes: roots[0].changes }], { interactive: false }, deps)
      expect(output()).toContain('apps/acme-api/package-lock.json still holds the previous ones')
      expect(output()).toContain(`Resolve it again: cd apps/acme-api && ${LOCKFILE_RESOLVE_COMMAND}`)
    })

    it('does nothing when no lockfile holds a changed pin', async () => {
      const deps = depsWith({})
      expect(await offerLockfileResolution([], { interactive: true }, deps)).toEqual([])
      expect(lines).toEqual([])
    })
  })

  it('tells a package.json sidecar will need the lockfile resolved once merged', () => {
    const lines: string[] = []
    logPendingSidecarPins([{ root: '.', changes: [{ manifest: 'apps/web/package.json', name: 'react', field: 'dependencies', from: '19.2.5', to: '19.3.1' }] }], (line) => lines.push(line))
    const text = strip(lines.join('\n'))
    expect(text).toContain('apps/web/package.json.saasfoundry.new changes pinned versions')
    expect(text).toContain(`Once merged, resolve the lockfile again: ${LOCKFILE_RESOLVE_COMMAND}`)
  })
})
