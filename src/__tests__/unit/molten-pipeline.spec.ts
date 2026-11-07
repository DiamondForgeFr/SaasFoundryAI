import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { declaredMoltenJobs, readMoltenCiJobs } from '../../molten-pipeline'

// #1155 — the jobs a .molten/project.json declares; a pipeline counts only when it declares at least one.
describe('the CI jobs a MoltenTerm pipeline declares', () => {
  it('reads the named entries of ci.jobs, with their title and lane', () => {
    const project = {
      ci: {
        jobs: [
          { name: 'format', title: 'Format check', lane: 'guards', run: 'npm run format:check' },
          { name: 'unit', run: 'npm run test:unit' }
        ]
      }
    }
    expect(declaredMoltenJobs(project)).toEqual([{ name: 'format', title: 'Format check', lane: 'guards' }, { name: 'unit' }])
  })

  it.each([
    ['nothing', undefined],
    ['a non-object', 'pipeline'],
    ['no ci block', { name: 'demo', icon: 'icon.svg' }],
    ['ci without jobs', { ci: { prepare: { run: 'npm ci' } } }],
    ['jobs that is not a list', { ci: { jobs: { name: 'unit' } } }],
    ['an empty jobs list', { ci: { jobs: [] } }],
    ['entries without a name', { ci: { jobs: [{ run: 'npm test' }, { name: '  ' }, 'lint', null] } }]
  ])('declares no job for %s', (_case, project) => {
    expect(declaredMoltenJobs(project)).toEqual([])
  })

  describe('from disk', () => {
    let root: string
    beforeEach(async () => {
      root = await mkdtemp(join(tmpdir(), 'sf-molten-pipeline-'))
    })
    afterEach(async () => rm(root, { recursive: true, force: true }))

    it('is undefined without the file, and empty for a file that declares no job', async () => {
      expect(readMoltenCiJobs(root)).toBeUndefined()
      await mkdir(join(root, '.molten'))
      await writeFile(join(root, '.molten', 'project.json'), JSON.stringify({ schema: 1, name: 'demo', icon: 'icon.svg' }))
      expect(readMoltenCiJobs(root)).toEqual([])
    })

    it('throws on a damaged file', async () => {
      await mkdir(join(root, '.molten'))
      await writeFile(join(root, '.molten', 'project.json'), '{ nope')
      expect(() => readMoltenCiJobs(root)).toThrow()
    })
  })
})
