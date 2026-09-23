import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { finishLifecyclePhase, startLifecyclePhase, startLifecycleTiming, writeLifecycleTiming } from '../../../../tests/docker/lifecycle/timings'

describe('lifecycle timing evidence', () => {
  it('writes bounded versioned monotonic evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sf-timing-'))
    const previous = process.env.SF_TEST_ARTIFACTS_DIR
    process.env.SF_TEST_ARTIFACTS_DIR = root
    try {
      const start = startLifecycleTiming()
      const phase = startLifecyclePhase('generated project boot')
      start.phases.push(finishLifecyclePhase(phase, 'passed'))
      await writeLifecycleTiming('new-monorepo', 'full', start, 'failed', { budgetMs: 1_800_000, teardownReserveMs: 30_000 })
      const payload = JSON.parse(await readFile(join(root, 'timings', 'new-monorepo.json'), 'utf8')) as Record<string, unknown>
      expect(payload).toMatchObject({ schemaVersion: 1, scenario: 'new-monorepo', depth: 'full', status: 'failed' })
      expect(payload.durationMs).toEqual(expect.any(Number))
      expect(payload).toMatchObject({ budgetMs: 1_800_000, teardownReserveMs: 30_000 })
      expect(payload.phases).toEqual([expect.objectContaining({ name: 'generated project boot', status: 'passed', durationMs: expect.any(Number) })])
      expect(payload).not.toHaveProperty('error')
    } finally {
      if (previous === undefined) delete process.env.SF_TEST_ARTIFACTS_DIR
      else process.env.SF_TEST_ARTIFACTS_DIR = previous
      await rm(root, { recursive: true, force: true })
    }
  })
})
