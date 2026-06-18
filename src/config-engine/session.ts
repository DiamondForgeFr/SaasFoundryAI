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

/** Sentinel value returned by the recap prompt when the user confirms. */
const RECAP_CONFIRM = '__recap_confirm__'

/**
 * Run the collection session: iterate the step registry, gate each step on
 * its applicability, expose derivations from earlier answers, render fields
 * through the given renderer and accumulate one state object. Interactive
 * sessions then enter an editable recap loop (FR-CONFIG-ENGINE-06) before the
 * validated config is handed to execution.
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
  // Per-step collected answers, kept so the recap can be recomputed after an
  // edit re-runs a single step. Insertion order = recap display order.
  const collectedByStep = new Map<string, ConfigState>()

  /**
   * Run one step: gate on applicability, render its fields + collect, and
   * record the result. In `editMode` the step's own questions are re-asked
   * (the accumulated state would otherwise satisfy the prefill and skip them).
   */
  async function collectStep(step: StepDefinition, editMode = false): Promise<void> {
    const derived = computeDerivations(state)
    const sessionCtx = { prefill, nonInteractive, derived }

    if (step.appliesTo && !step.appliesTo(state, sessionCtx)) {
      collectedByStep.delete(step.id)
      return
    }

    const renderPrefill = editMode ? { ...prefill } : { ...prefill, ...state }
    const render = (fields: Parameters<Renderer['render']>[0]) => renderer.render(fields, { prefill: renderPrefill, nonInteractive })

    let collected: ConfigState = {}
    if (step.fields?.length) {
      collected = await render(step.fields)
    }
    if (step.collect) {
      collected = { ...collected, ...(await step.collect({ ...sessionCtx, state, render })) }
    }

    Object.assign(state, collected)
    collectedByStep.set(step.id, collected)
  }

  const buildRecap = (): RecapDecision[] => {
    const out: RecapDecision[] = []
    for (const [stepId, collected] of collectedByStep) {
      const step = steps.find((s) => s.id === stepId)
      if (!step) continue
      out.push(...(step.decisions ? step.decisions(collected, state) : defaultDecisions(step, collected)))
    }
    return out
  }

  // Collection pass.
  for (const step of steps) {
    await collectStep(step)
  }

  // Interactive recap loop — list every decision, jump back to the owning step
  // on edit (answers preserved, derivations re-run), proceed on confirm.
  if (!nonInteractive) {
    await runRecapLoop(renderer, buildRecap, async (stepId) => {
      const step = steps.find((s) => s.id === stepId)
      if (step) await collectStep(step, true)
    })
  }

  return { config: state as ValidatedConfig, recap: buildRecap() }
}

/**
 * Render the recap, let the user edit a line or confirm, looping until they
 * confirm. Editing re-runs the owning step through `editStep`, after which the
 * recap is rebuilt (so derivation-driven values refresh).
 */
async function runRecapLoop(renderer: Renderer, buildRecap: () => RecapDecision[], editStep: (stepId: string) => Promise<void>): Promise<void> {
  for (;;) {
    const recap = buildRecap()
    const choices = [
      ...recap.map((decision, index) => ({ name: `${decision.name}: ${formatRecapValue(decision.value)}`, value: String(index) })),
      { name: '✅ Confirm and continue', value: RECAP_CONFIRM }
    ]

    const answer = (await renderer.render([{ type: 'list', name: '__recapChoice', message: 'Review your configuration — select a line to change it, or confirm:', choices, default: RECAP_CONFIRM }], {
      prefill: {},
      nonInteractive: false
    })) as Record<string, unknown>

    const choice = answer.__recapChoice as string | undefined
    if (!choice || choice === RECAP_CONFIRM) return

    const decision = recap[Number(choice)]
    if (decision) await editStep(decision.stepId)
  }
}

/** Human-readable rendering of a recap value for the selection list. */
function formatRecapValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—'
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : '—'
  if (typeof value === 'object') return '[configured]'
  return String(value)
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
