import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { computeFileUpdates } from '../../../commands/update'
import { computeFileHashes, hashFileContent, isDerivedArtefact } from '../../../utils'

describe('isDerivedArtefact (#874)', () => {
  it.each([
    'apps/api/src/generated/prisma/models/Account.ts',
    'apps/api/src/generated/prisma/client.ts',
    'apps/acme-api/src/generated/prisma/models/Role.ts',
    'packages/api-client/src/generated/api/model/accountDto.ts',
    'packages/api-client/src/generated',
    'apps/api/docs/openapi.json',
    'apps/acme-api/docs/openapi.json'
  ])('treats %s as codegen output', (path) => {
    expect(isDerivedArtefact(path)).toBe(true)
  })

  it.each([
    'apps/api/docs/index.html',
    'docs/openapi.json',
    'apps/api/src/generator.ts',
    'apps/api/src/modules/generated-reports/report.service.ts',
    'packages/api-client/src/http-client.ts',
    'packages/api-client/orval.config.ts',
    'apps/api/prisma/schema/schema.prisma'
  ])('keeps %s as a template', (path) => {
    expect(isDerivedArtefact(path)).toBe(false)
  })
})

describe('sf update over derived artefacts (#874)', () => {
  let project: string

  const write = async (relative: string, content: string) => {
    await mkdir(dirname(join(project, relative)), { recursive: true })
    await writeFile(join(project, relative), content)
  }

  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), 'sf-derived-'))
  })

  afterEach(async () => {
    await rm(project, { recursive: true, force: true })
  })

  it('does not hash codegen output into the manifest', async () => {
    await write('apps/api/src/generated/prisma/models/Account.ts', 'export type Account = {}\n')
    await write('packages/api-client/src/generated/api/model/accountDto.ts', 'export interface AccountDto {}\n')
    await write('apps/api/docs/openapi.json', '{"openapi":"3.0.0"}\n')
    await write('apps/api/docs/index.html', '<html></html>\n')
    await write('apps/api/src/main.ts', 'bootstrap()\n')

    expect(Object.keys(await computeFileHashes(project)).sort()).toEqual(['apps/api/docs/index.html', 'apps/api/src/main.ts'])
  })

  it('plans no conflict and no removal for baselines an older CLI recorded on derived paths', async () => {
    // A 1.0.0-beta manifest tracked the generated clients. The project has regenerated them
    // since, and the regenerated templates no longer carry the Prisma models at all.
    const target = await mkdtemp(join(tmpdir(), 'sf-derived-target-'))
    try {
      await write('apps/api/src/generated/prisma/models/Account.ts', 'export type Account = { id: string }\n')
      await write('packages/api-client/src/generated/api/model/accountDto.ts', 'export interface AccountDto { id: string }\n')
      await write('apps/api/src/main.ts', 'bootstrap()\n')
      await mkdir(join(target, 'packages/api-client/src/generated/api/model'), { recursive: true })
      await mkdir(join(target, 'apps/api/src'), { recursive: true })
      await writeFile(join(target, 'packages/api-client/src/generated/api/model/accountDto.ts'), 'export interface AccountDto { v2: true }\n')
      await writeFile(join(target, 'apps/api/src/main.ts'), 'bootstrap()\n')
      const base = {
        'apps/api/src/generated/prisma/models/Account.ts': hashFileContent('export type Account = { id: string }\n'),
        'packages/api-client/src/generated/api/model/accountDto.ts': hashFileContent('export interface AccountDto {}\n'),
        'apps/api/src/main.ts': hashFileContent('bootstrap()\n')
      }

      const updates = computeFileUpdates(base, await computeFileHashes(project), await computeFileHashes(target))

      expect(updates).toEqual([])
    } finally {
      await rm(target, { recursive: true, force: true })
    }
  })
})
