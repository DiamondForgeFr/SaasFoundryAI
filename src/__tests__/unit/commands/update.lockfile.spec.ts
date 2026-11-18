import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  API_CLIENT_CODEGEN_COMMAND,
  apiClientCodegenReason,
  duplicatedFrameworks,
  findLockfileRoot,
  groupByLockfileRoot,
  isApiClientCodegenInput,
  isPackageManifestPath,
  LOCKFILE_RESOLVE_COMMAND,
  logPendingSidecarPins,
  offerLockfileResolution,
  pinChanges,
  planApiClientCodegen,
  PRISMA_GENERATE_COMMAND,
  prismaClientTargets,
  readPackageManifests,
  regenerateApiClients,
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

    describe('an update that bumps Prisma (#1246)', () => {
      const prismaBump: LockfileRoot[] = [
        {
          root: '.',
          changes: [
            { manifest: 'apps/api/package.json', name: '@prisma/client', field: 'dependencies', from: '7.10.0', to: '7.10.1' },
            { manifest: 'apps/api/package.json', name: 'prisma', field: 'devDependencies', from: '7.10.0', to: '7.10.1' },
            { manifest: 'apps/web/package.json', name: 'react', field: 'dependencies', from: '19.2.5', to: '19.3.1' }
          ]
        }
      ]
      const generateCommand = `cd apps/api && ${PRISMA_GENERATE_COMMAND}`

      it('regenerates the client in the API, under its Node, after the resolve', async () => {
        const order: string[] = []
        const deps = depsWith({
          refresh: jest.fn(async () => {
            order.push('resolve')
          }),
          run: jest.fn((command: string) => {
            order.push(command)
            return { code: 0, stdout: command.includes('npm ls') ? JSON.stringify({ dependencies: {} }) : '', stderr: '' }
          }),
          nvmPrefix: (dir: string) => `NVM(${dir}); `
        })
        const [result] = await offerLockfileResolution(prismaBump, { interactive: true }, deps)
        expect(deps.run).toHaveBeenCalledWith(`NVM(apps/api); ${PRISMA_GENERATE_COMMAND}`, { cwd: 'apps/api' })
        expect(order[0]).toBe('resolve')
        expect(order.at(-1)).toBe(`NVM(apps/api); ${PRISMA_GENERATE_COMMAND}`)
        expect(result.prismaClients).toEqual([{ dir: 'apps/api', to: '7.10.1', outcome: 'regenerated' }])
        expect(output()).toContain('Prisma client regenerated at 7.10.1 (apps/api/src/generated/prisma)')
        expect(output()).not.toContain(generateCommand)
      })

      it('names the prisma generate command among the steps on a non-interactive run', async () => {
        const deps = depsWith({})
        const [result] = await offerLockfileResolution(prismaBump, { interactive: false }, deps)
        expect(deps.run).not.toHaveBeenCalled()
        expect(result.prismaClients).toEqual([{ dir: 'apps/api', to: '7.10.1', outcome: 'manual' }])
        expect(output()).toContain(`Once installed, regenerate the Prisma client the API commits (prisma 7.10.0 → 7.10.1): ${generateCommand}`)
      })

      it('names the command when the developer declines, or when the resolve fails', async () => {
        const declined = await offerLockfileResolution(prismaBump, { interactive: true }, depsWith({ confirm: jest.fn(async () => false) }))
        const failed = await offerLockfileResolution(
          prismaBump,
          { interactive: true },
          depsWith({
            refresh: jest.fn(async () => {
              throw new Error('lock refresh failed')
            })
          })
        )
        expect(declined[0].prismaClients).toEqual([{ dir: 'apps/api', to: '7.10.1', outcome: 'manual' }])
        expect(failed[0].prismaClients).toEqual([{ dir: 'apps/api', to: '7.10.1', outcome: 'manual' }])
        expect(output().split(generateCommand)).toHaveLength(3)
      })

      it('reports a failed generate with the command to retry', async () => {
        const deps = depsWith({
          run: jest.fn((command: string) => (command.includes('prisma generate') ? { code: 1, stdout: '', stderr: 'Error: Could not load schema' } : { code: 0, stdout: '{}', stderr: '' }))
        })
        const [result] = await offerLockfileResolution(prismaBump, { interactive: true }, deps)
        expect(result.outcome).toBe('resolved')
        expect(result.prismaClients).toEqual([{ dir: 'apps/api', to: '7.10.1', outcome: 'failed' }])
        expect(output()).toContain('Regenerating the Prisma client failed (exit 1)')
        expect(output()).toContain('Could not load schema')
        expect(output()).toContain('To retry, regenerate the Prisma client')
        expect(output()).toContain(generateCommand)
      })

      it('runs the command in a multirepo API, its own lockfile root', async () => {
        const deps = depsWith({})
        const changes = [{ manifest: 'apps/acme-api/package.json', name: 'prisma', field: 'devDependencies', from: '7.10.0', to: '7.10.1' }]
        const [result] = await offerLockfileResolution([{ root: 'apps/acme-api', changes }], { interactive: true }, deps)
        expect(deps.run).toHaveBeenCalledWith(`NVM; ${PRISMA_GENERATE_COMMAND}`, { cwd: 'apps/acme-api' })
        expect(result.prismaClients).toEqual([{ dir: 'apps/acme-api', to: '7.10.1', outcome: 'regenerated' }])
      })

      it('leaves the client alone when no Prisma pin moved', async () => {
        const deps = depsWith({})
        const [result] = await offerLockfileResolution(roots, { interactive: true }, deps)
        expect(result.prismaClients).toBeUndefined()
        expect(deps.run).not.toHaveBeenCalledWith(expect.stringContaining('prisma generate'), expect.anything())
      })
    })

    describe('an update that moves the API client codegen (#1264)', () => {
      const orvalBump: LockfileRoot[] = [
        {
          root: '.',
          changes: [
            { manifest: 'packages/api-client/package.json', name: 'orval', field: 'devDependencies', from: '8.28.1', to: '8.47.0' },
            { manifest: 'package.json', name: 'prettier', field: 'devDependencies', from: '3.8.3', to: '3.8.5' }
          ],
          apiClient: { reason: 'orval 8.28.1 → 8.47.0' }
        }
      ]

      it('regenerates the client at the root, under its Node, after the resolve', async () => {
        const order: string[] = []
        const deps = depsWith({
          refresh: jest.fn(async () => {
            order.push('resolve')
          }),
          run: jest.fn((command: string) => {
            order.push(command)
            return { code: 0, stdout: command.includes('npm ls') ? JSON.stringify({ dependencies: {} }) : '', stderr: '' }
          })
        })
        const [result] = await offerLockfileResolution(orvalBump, { interactive: true }, deps)
        expect(deps.run).toHaveBeenCalledWith(`NVM; ${API_CLIENT_CODEGEN_COMMAND}`, { cwd: '.' })
        expect(order[0]).toBe('resolve')
        expect(order.at(-1)).toBe(`NVM; ${API_CLIENT_CODEGEN_COMMAND}`)
        expect(result.apiClient).toEqual({ root: '.', outcome: 'regenerated' })
        expect(output()).toContain('API client regenerated (orval 8.28.1 → 8.47.0): commit it with the update')
      })

      it('names npm run codegen among the steps when the lockfile is not resolved', async () => {
        const nonInteractive = await offerLockfileResolution(orvalBump, { interactive: false }, depsWith({}))
        const declined = await offerLockfileResolution(orvalBump, { interactive: true }, depsWith({ confirm: jest.fn(async () => false) }))
        expect(nonInteractive[0].apiClient).toEqual({ root: '.', outcome: 'manual' })
        expect(declined[0].apiClient).toEqual({ root: '.', outcome: 'manual' })
        expect(output()).toContain(`Once installed, regenerate the API client the project commits (orval 8.28.1 → 8.47.0): ${API_CLIENT_CODEGEN_COMMAND}`)
      })

      it('reports a failed codegen with the command to retry', async () => {
        const deps = depsWith({
          run: jest.fn((command: string) => (command.includes('codegen') ? { code: 1, stdout: '', stderr: 'orval: cannot read openapi.json' } : { code: 0, stdout: '{}', stderr: '' }))
        })
        const [result] = await offerLockfileResolution(orvalBump, { interactive: true }, deps)
        expect(result.outcome).toBe('resolved')
        expect(result.apiClient).toEqual({ root: '.', outcome: 'failed' })
        expect(output()).toContain('Regenerating the API client failed (exit 1)')
        expect(output()).toContain('cannot read openapi.json')
        expect(output()).toContain(`To retry, regenerate the API client the project commits (orval 8.28.1 → 8.47.0): ${API_CLIENT_CODEGEN_COMMAND}`)
      })

      it('leaves the client alone in a root that generates none', async () => {
        const deps = depsWith({})
        const [result] = await offerLockfileResolution(roots, { interactive: true }, deps)
        expect(result.apiClient).toBeUndefined()
        expect(deps.run).not.toHaveBeenCalledWith(expect.stringContaining('codegen'), expect.anything())
      })
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
    expect(text).not.toContain('prisma generate')
  })

  it('tells a package.json sidecar that bumps Prisma will need the client regenerated (#1246)', () => {
    const lines: string[] = []
    logPendingSidecarPins([{ root: '.', changes: [{ manifest: 'apps/api/package.json', name: 'prisma', field: 'devDependencies', from: '7.10.0', to: '7.10.1' }] }], (line) => lines.push(line))
    expect(strip(lines.join('\n'))).toContain(`(prisma 7.10.0 → 7.10.1): cd apps/api && ${PRISMA_GENERATE_COMMAND}`)
  })

  it('tells a package.json sidecar that bumps orval will need the API client regenerated (#1264)', () => {
    const lines: string[] = []
    logPendingSidecarPins(
      [
        {
          root: '.',
          changes: [{ manifest: 'packages/api-client/package.json', name: 'orval', field: 'devDependencies', from: '8.28.1', to: '8.47.0' }],
          apiClient: { reason: 'orval 8.28.1 → 8.47.0' }
        }
      ],
      (line) => lines.push(line)
    )
    expect(strip(lines.join('\n'))).toContain(`(orval 8.28.1 → 8.47.0): ${API_CLIENT_CODEGEN_COMMAND}`)
  })

  describe('API client codegen (#1264)', () => {
    it('recognises the codegen files orval reads', () => {
      expect(isApiClientCodegenInput('packages/api-client/orval.config.ts')).toBe(true)
      expect(isApiClientCodegenInput('packages/api-client/src/http-client.ts')).toBe(true)
      expect(isApiClientCodegenInput('packages/api-client/src/index.ts')).toBe(false)
      expect(isApiClientCodegenInput('apps/web/src/http-client.ts')).toBe(false)
    })

    it('names the orval pin first, then prettier, then the rewritten codegen files', () => {
      const orval = { manifest: 'packages/api-client/package.json', name: 'orval', field: 'devDependencies', from: '8.28.1', to: '8.47.0' }
      const prettier = { manifest: 'package.json', name: 'prettier', field: 'devDependencies', from: '3.8.3', to: '3.8.5' }
      expect(apiClientCodegenReason([prettier, orval])).toBe('orval 8.28.1 → 8.47.0')
      expect(apiClientCodegenReason([prettier])).toBe('prettier 3.8.3 → 3.8.5')
      expect(apiClientCodegenReason([], ['packages/api-client/orval.config.ts'])).toBe('packages/api-client/orval.config.ts updated')
    })

    it('ignores an added or removed orval pin, an override and other packages', () => {
      expect(
        apiClientCodegenReason([
          { manifest: 'packages/api-client/package.json', name: 'orval', field: 'devDependencies', to: '8.47.0' },
          { manifest: 'package.json', name: 'orval', field: 'overrides', from: '"8.28.1"', to: '"8.47.0"' },
          { manifest: 'apps/web/package.json', name: 'react', field: 'dependencies', from: '19.2.5', to: '19.3.1' }
        ])
      ).toBeUndefined()
    })

    describe('planApiClientCodegen', () => {
      let project: string
      const orval = { manifest: 'packages/api-client/package.json', name: 'orval', field: 'devDependencies', from: '8.28.1', to: '8.47.0' }
      beforeEach(async () => {
        project = await mkdtemp(join(tmpdir(), 'sf-api-client-plan-'))
      })
      afterEach(async () => {
        await rm(project, { recursive: true, force: true })
      })
      const monorepo = async (): Promise<void> => {
        await mkdir(join(project, 'packages/api-client'), { recursive: true })
        await writeFile(join(project, 'package-lock.json'), '{}')
        await writeFile(join(project, 'package.json'), JSON.stringify({ scripts: { codegen: 'turbo run codegen' } }))
      }

      it('marks the monorepo root whose orval pin moved', async () => {
        await monorepo()
        const plan = await planApiClientCodegen(project, [{ root: '.', changes: [orval] }])
        expect(plan).toEqual({ roots: [{ root: '.', changes: [orval], apiClient: { reason: 'orval 8.28.1 → 8.47.0' } }], standalone: [] })
      })

      it('regenerates after the resolve when a codegen file changed with the pins', async () => {
        await monorepo()
        const react = { manifest: 'apps/web/package.json', name: 'react', field: 'dependencies', from: '19.2.5', to: '19.3.1' }
        const plan = await planApiClientCodegen(project, [{ root: '.', changes: [react] }], ['packages/api-client/orval.config.ts', 'README.md'])
        expect(plan.roots[0].apiClient).toEqual({ reason: 'packages/api-client/orval.config.ts updated' })
        expect(plan.standalone).toEqual([])
      })

      it('returns a codegen file rewritten without any pin change apart', async () => {
        await monorepo()
        const plan = await planApiClientCodegen(project, [], ['packages/api-client/src/http-client.ts'])
        expect(plan).toEqual({ roots: [], standalone: [{ root: '.', reason: 'packages/api-client/src/http-client.ts updated' }] })
      })

      it('leaves a root that declares no codegen script alone: a multirepo app', async () => {
        await mkdir(join(project, 'apps/acme-web'), { recursive: true })
        await writeFile(join(project, 'apps/acme-web/package.json'), JSON.stringify({ scripts: { build: 'vite build' } }))
        const prettier = { manifest: 'apps/acme-web/package.json', name: 'prettier', field: 'devDependencies', from: '3.8.3', to: '3.8.5' }
        const plan = await planApiClientCodegen(project, [{ root: 'apps/acme-web', changes: [prettier] }])
        expect(plan).toEqual({ roots: [{ root: 'apps/acme-web', changes: [prettier] }], standalone: [] })
      })
    })

    describe('regenerateApiClients', () => {
      it('runs the codegen at once on an interactive run: the installed toolchain is already right', () => {
        const lines: string[] = []
        const run = jest.fn(() => ({ code: 0, stdout: '', stderr: '' }))
        const results = regenerateApiClients(
          [{ root: '.', reason: 'packages/api-client/orval.config.ts updated' }],
          { interactive: true },
          { run, nvmPrefix: () => 'NVM; ', log: (line) => lines.push(line) }
        )
        expect(run).toHaveBeenCalledWith(`NVM; ${API_CLIENT_CODEGEN_COMMAND}`, { cwd: '.' })
        expect(results).toEqual([{ root: '.', outcome: 'regenerated' }])
        expect(strip(lines.join('\n'))).toContain('codegen:check refuses a commit until the committed client is regenerated')
      })

      it('prints the command on a non-interactive run, and runs nothing', () => {
        const lines: string[] = []
        const run = jest.fn(() => ({ code: 0, stdout: '', stderr: '' }))
        const results = regenerateApiClients([{ root: '.', reason: 'packages/api-client/orval.config.ts updated' }], { interactive: false }, { run, log: (line) => lines.push(line) })
        expect(run).not.toHaveBeenCalled()
        expect(results).toEqual([{ root: '.', outcome: 'manual' }])
        expect(strip(lines.join('\n'))).toContain(`Before the next commit, regenerate the API client the project commits (packages/api-client/orval.config.ts updated): ${API_CLIENT_CODEGEN_COMMAND}`)
      })
    })
  })

  describe('prismaClientTargets (#1246)', () => {
    it('names the API whose prisma pin moved, at the CLI version', () => {
      expect(
        prismaClientTargets([
          { manifest: 'apps/api/package.json', name: '@prisma/client', field: 'dependencies', from: '7.10.0', to: '7.10.2' },
          { manifest: 'apps/api/package.json', name: 'prisma', field: 'devDependencies', from: '7.10.0', to: '7.10.1' }
        ])
      ).toEqual([{ dir: 'apps/api', from: '7.10.0', to: '7.10.1' }])
    })

    it('falls back to @prisma/client, and reads a root package.json as the current directory', () => {
      expect(prismaClientTargets([{ manifest: 'package.json', name: '@prisma/client', field: 'dependencies', from: '7.10.0', to: '7.10.1' }])).toEqual([{ dir: '.', from: '7.10.0', to: '7.10.1' }])
    })

    it('ignores an added or removed pin, an override and other packages', () => {
      expect(
        prismaClientTargets([
          { manifest: 'apps/api/package.json', name: 'prisma', field: 'devDependencies', to: '7.10.1' },
          { manifest: 'apps/api/package.json', name: '@prisma/client', field: 'dependencies', from: '7.10.0' },
          { manifest: 'package.json', name: 'prisma', field: 'overrides', from: '"7.10.0"', to: '"7.10.1"' },
          { manifest: 'apps/api/package.json', name: '@prisma/adapter-pg', field: 'dependencies', from: '7.10.0', to: '7.10.1' }
        ])
      ).toEqual([])
    })
  })
})
