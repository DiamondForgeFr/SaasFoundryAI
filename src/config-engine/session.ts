import { computeDerivations } from './derivations'
import { assertStepRegistry, configSteps } from './registry'
import { ConfigState, RecapDecision, Renderer, StepDefinition, ValidatedConfig } from './types'

export interface ConfigSessionOptions {
  renderer: Renderer
  prefill?: ConfigState
  nonInteractive?: boolean
  /** Step list override — defaults to the `sf new` registry. */
  steps?: StepDefinition[]
}

export interface ConfigSessionResult {
  config: ValidatedConfig
  /** Ordered decision list — the recap model (consumed by the recap step, FR-CONFIG-ENGINE-06). */
  recap: RecapDecision[]
}

/**
 * Run the collection session: iterate the step registry, gate each step on
 * its applicability, expose derivations from earlier answers, render fields
 * through the given renderer and accumulate one state object.
 *
 * The renderer is the only component allowed to talk to the user — the
 * session itself is medium-agnostic, and in non-interactive mode the renderer
 * is expected to throw on missing required values (see `promptWithPrefill`).
 */
export async function runConfigSession(options: ConfigSessionOptions): Promise<ConfigSessionResult> {
  const { renderer, prefill = {}, nonInteractive = false } = options
  const steps = options.steps ?? configSteps
  assertStepRegistry(steps)

  const state: ConfigState = {}
  const recap: RecapDecision[] = []

  for (const step of steps) {
    const derived = computeDerivations(state)
    const sessionCtx = { prefill, nonInteractive, derived }

    if (step.appliesTo && !step.appliesTo(state, sessionCtx)) continue

    const render = (fields: Parameters<Renderer['render']>[0]) => renderer.render(fields, { prefill: { ...prefill, ...state }, nonInteractive })

    let collected: ConfigState = {}
    if (step.fields?.length) {
      collected = await render(step.fields)
    }
    if (step.collect) {
      collected = { ...collected, ...(await step.collect({ ...sessionCtx, state, render })) }
    }

    Object.assign(state, collected)
    recap.push(...(step.decisions ? step.decisions(collected, state) : defaultDecisions(step, collected)))
  }

  return { config: state as ValidatedConfig, recap }
}

/**
 * Default recap entries: one per declared field root that ended up with a
 * value (dot-notation names collapse onto their root object, e.g. every
 * `dbCredentials.*` field becomes a single `dbCredentials` decision).
 */
function defaultDecisions(step: StepDefinition, collected: ConfigState): RecapDecision[] {
  const roots: string[] = []
  for (const field of step.fields ?? []) {
    const root = field.name.split('.')[0]
    if (!roots.includes(root)) roots.push(root)
  }
  const record = collected as Record<string, unknown>
  return roots.filter((root) => record[root] !== undefined).map((root) => ({ stepId: step.id, name: root, value: record[root] }))
}
