import { existsSync } from 'fs'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { collectStatus } from '../../../status/collect'
import { localCiSummary, renderAgentFriendly, renderHuman, renderJson } from '../../../status/render'

const AT = '2026-10-21T08:00:00.000Z'
/** A `.molten/project.json` declaring `jobs` jobs, shaped like the one this repository commits. */
const pipeline = (jobs: number) => ({
  schema: 1,
  name: 'status-demo',
  ci: {
    prepare: { run: 'npm ci' },
    statuses: 'github',
    jobs: Array.from({ length: jobs }, (_, index) => ({ name: `job-${index}`, title: `Job ${index}`, lane: 'unit', run: 'npm run test:unit' }))
  }
})

describe('the local CI pipeline in sf status (#943)', () => {
  describe('localCiSummary', () => {
    it('names the MoltenTerm pipeline and counts its jobs', () => {
      expect(localCiSummary({ runner: 'molten', jobs: 11 })).toBe('MoltenTerm pipeline (11 jobs)')
      expect(localCiSummary({ runner: 'molten', jobs: 1 })).toBe('MoltenTerm pipeline (1 job)')
    })

    it('names the npm suite when the file declares no CI job (#1155)', () => {
      expect(localCiSummary({ runner: 'npm', reason: 'no-ci-jobs' })).toBe('npm suite (.molten/project.json declares no CI job)')
    })

    it('says an unreadable file, and does not raise', () => {
      expect(localCiSummary({ error: '.molten/project.json: Unexpected token' })).toBe('unreadable (.molten/project.json: Unexpected token)')
    })
  })

  describe('the status of a project', () => {
    let root: string
    const report = () => collectStatus(root, { checkNetwork: false })
    const render = async (renderer: typeof renderAgentFriendly) => renderer({ report: await report(), preconditions: [] })
    const pipelineFile = () => join(root, '.molten', 'project.json')

    beforeEach(async () => {
      root = await realpath(await mkdtemp(join(tmpdir(), 'sf-status-local-ci-')))
      await writeFile(join(root, '.saasfoundry.json'), JSON.stringify({ version: '1.0.0-beta', projectName: 'status-demo', structure: 'cli', generatedAt: AT }, null, 2) + '\n')
    })
    afterEach(async () => rm(root, { recursive: true, force: true }))

    it('has no local CI line on a project that declares no pipeline', async () => {
      expect((await report()).localCi).toBeUndefined()
      expect(await render(renderAgentFriendly)).not.toContain('local-ci:')
      expect(await render(renderHuman)).not.toContain('local-ci:')
      expect(JSON.parse(await render(renderJson)).localCi).toBeNull()
    })

    it('counts the jobs of the declared pipeline and shows it in the three outputs', async () => {
      await mkdir(join(root, '.molten'))
      await writeFile(pipelineFile(), JSON.stringify(pipeline(11)))
      expect((await report()).localCi).toEqual({ runner: 'molten', jobs: 11 })
      expect(await render(renderAgentFriendly)).toContain('- local-ci: MoltenTerm pipeline (11 jobs)')
      // The human output is coloured: match across the colour codes rather than on the exact text.
      expect(await render(renderHuman)).toMatch(/local-ci:.*MoltenTerm pipeline \(11 jobs\)/)
      expect(JSON.parse(await render(renderJson)).localCi).toEqual({ runner: 'molten', jobs: 11 })
    })

    // #1155 — a file holding only the project name and icon (DiamondForge) is no pipeline: the npm suite runs.
    it.each([
      ['no ci block', { schema: 1, name: 'status-demo', icon: 'icon.svg' }],
      ['a ci block without jobs', { schema: 1, name: 'status-demo', ci: { prepare: { run: 'npm ci' } } }],
      ['an empty jobs list', pipeline(0)],
      ['jobs without a name', { schema: 1, name: 'status-demo', ci: { jobs: [{ run: 'npm test' }, 'lint'] } }]
    ])('reports the npm suite for a file with %s, never a pipeline of 0 jobs', async (_case, file) => {
      await mkdir(join(root, '.molten'))
      await writeFile(pipelineFile(), JSON.stringify(file))
      expect((await report()).localCi).toEqual({ runner: 'npm', reason: 'no-ci-jobs' })
      const agentFriendly = await render(renderAgentFriendly)
      expect(agentFriendly).toContain('- local-ci: npm suite (.molten/project.json declares no CI job)')
      expect(agentFriendly).not.toContain('MoltenTerm pipeline')
      expect(await render(renderHuman)).toMatch(/local-ci:.*npm suite/)
      expect(JSON.parse(await render(renderJson)).localCi).toEqual({ runner: 'npm', reason: 'no-ci-jobs' })
    })

    it('says a damaged file is unreadable, and never fails the status', async () => {
      await mkdir(join(root, '.molten'))
      await writeFile(pipelineFile(), '{ nope')
      const localCi = (await report()).localCi as { error: string }
      expect(localCi.error).toContain('.molten/project.json:')
      expect(await render(renderAgentFriendly)).toContain('- local-ci: unreadable (.molten/project.json:')
    })

    it('reads the file only: a molten on the PATH is never called', async () => {
      const bin = join(root, 'bin')
      const marker = join(root, 'molten-ran')
      await mkdir(bin)
      await writeFile(join(bin, 'molten'), `#!/bin/sh\ntouch "${marker}"\n`, { mode: 0o755 })
      await mkdir(join(root, '.molten'))
      await writeFile(pipelineFile(), JSON.stringify(pipeline(2)))
      const originalPath = process.env.PATH
      process.env.PATH = `${bin}:${originalPath ?? ''}`
      try {
        await report()
      } finally {
        process.env.PATH = originalPath
      }
      expect(existsSync(marker)).toBe(false)
    })
  })
})
