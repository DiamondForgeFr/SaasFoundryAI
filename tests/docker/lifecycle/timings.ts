import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

export interface LifecycleTiming {
  schemaVersion: 1
  scenario: string
  depth: 'smoke' | 'full'
  status: 'passed' | 'failed' | 'crashed' | 'aborted'
  startedAt: string
  finishedAt: string
  durationMs: number
  budgetMs: number
  teardownReserveMs: number
  phases: LifecyclePhaseTiming[]
}

export interface LifecyclePhaseTiming {
  name: string
  status: 'passed' | 'failed'
  startedAt: string
  finishedAt: string
  durationMs: number
}

export interface LifecycleTimingStart {
  startedAt: string
  monotonicStart: number
  phases: LifecyclePhaseTiming[]
}

export function startLifecycleTiming(): LifecycleTimingStart {
  return { startedAt: new Date().toISOString(), monotonicStart: performance.now(), phases: [] }
}

export function startLifecyclePhase(name: string): { name: string; startedAt: string; monotonicStart: number } {
  return { name, startedAt: new Date().toISOString(), monotonicStart: performance.now() }
}

export function finishLifecyclePhase(phase: ReturnType<typeof startLifecyclePhase>, status: LifecyclePhaseTiming['status']): LifecyclePhaseTiming {
  return {
    name: phase.name,
    status,
    startedAt: phase.startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Math.max(0, Math.round(performance.now() - phase.monotonicStart))
  }
}

export async function writeLifecycleTiming(
  scenario: string,
  depth: 'smoke' | 'full',
  start: ReturnType<typeof startLifecycleTiming>,
  status: LifecycleTiming['status'],
  budget: { budgetMs: number; teardownReserveMs: number }
): Promise<void> {
  const root = resolve(process.env.SF_TEST_ARTIFACTS_DIR ?? join(process.cwd(), '.tmp', 'docker-artifacts'))
  const directory = join(root, 'timings')
  await mkdir(directory, { recursive: true })
  const timing: LifecycleTiming = {
    schemaVersion: 1,
    scenario,
    depth,
    status,
    startedAt: start.startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Math.max(0, Math.round(performance.now() - start.monotonicStart)),
    budgetMs: budget.budgetMs,
    teardownReserveMs: budget.teardownReserveMs,
    phases: start.phases
  }
  await writeFile(join(directory, `${scenario}.json`), `${JSON.stringify(timing, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
}
