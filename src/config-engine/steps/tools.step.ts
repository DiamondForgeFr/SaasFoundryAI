import chalk from 'chalk'

import { Answers, ToolSelection } from '../../types'
import { findTool, SINGLE_SELECT_CATEGORIES, ToolCategory, toolsByCategory } from '../../tools/catalogue'
import { checkConnection } from '../../tools/connection-checks'
import { ConfigState, RecapDecision, StepContext, StepDefinition } from '../types'

const NONE = '__none__'

type ToolSelections = NonNullable<Answers['toolSelections']>

/**
 * Tools-first step (FR-CONFIG-ENGINE-04). Runs ahead of the workflow/skills/SRS
 * steps so the entry-point tools are chosen once, by category, and downstream
 * steps drive off the selection (via derivations) instead of re-asking.
 *
 * A connection check runs per selected tool and is shown as ok/warn — a warn
 * NEVER blocks the stepper, it just defers credential entry. Network calls are
 * skipped entirely in non-interactive runs and under `--no-network`.
 */
export const toolsStep: StepDefinition = {
  id: 'tools',
  title: 'Tools',
  effects: ['Runs live connection checks (network calls to tool APIs) during collection, unless --no-network or non-interactive'],
  appliesTo: (state) => state.profile !== 'stack',
  collect: async (ctx) => {
    if (ctx.nonInteractive) {
      // Selections come from flags (--tracker/--docs/--design), wired into
      // prefill.toolSelections. No network, no prompts.
      const fromFlags = ctx.prefill.toolSelections
      return fromFlags ? { toolSelections: normalize(fromFlags) } : {}
    }
    return collectInteractive(ctx)
  },
  decisions: (collected) => {
    const selections = collected.toolSelections ?? {}
    const out: RecapDecision[] = [
      { stepId: 'tools', name: 'tracker', value: selections.tracker?.name ?? 'none' },
      { stepId: 'tools', name: 'docs', value: selections.docs?.name ?? 'none' },
      { stepId: 'tools', name: 'design', value: (selections.design ?? []).map((d) => d.name) }
    ]
    return out
  }
}

/** Drop empty categories so the manifest never carries `{ tracker: undefined }`. */
function normalize(selections: ToolSelections): ToolSelections {
  const out: ToolSelections = {}
  if (selections.tracker?.name) out.tracker = selections.tracker
  if (selections.docs?.name) out.docs = selections.docs
  if (selections.design?.length) out.design = selections.design
  return out
}

async function collectInteractive(ctx: StepContext): Promise<ConfigState> {
  const { render, derived, prefill } = ctx

  console.log()
  console.log(chalk.cyan('🧰 Tools'))
  console.log(chalk.gray('Pick the entry-point tools for this project — one tracker, one docs backend, any design tools.'))
  console.log()

  const tracker = await pickSingle(render, 'tracker', 'Issue / project tracker:', derived.selectedTracker ?? prefill.workflow?.tool)
  const docs = await pickSingle(render, 'docs', 'Docs / SRS backend:', derived.selectedDocs)
  const design = await pickDesign(render)

  const selections: ToolSelections = {}
  if (tracker) selections.tracker = { name: tracker }
  if (docs) selections.docs = { name: docs }
  if (design.length) selections.design = design.map((name) => ({ name }))

  await runChecks(selections, Boolean((prefill as Answers).toolsNoNetwork))

  return { toolSelections: normalize(selections) }
}

async function pickSingle(render: StepContext['render'], category: ToolCategory, message: string, suggested?: string): Promise<string | undefined> {
  if (!SINGLE_SELECT_CATEGORIES.has(category)) throw new Error(`pickSingle called on multi-select category "${category}"`)
  const choices = [...toolsByCategory(category).map((t) => ({ name: t.displayName, value: t.name })), { name: 'None', value: NONE }]
  const isKnown = suggested && choices.some((c) => c.value === suggested)
  const answer = (await render([{ type: 'list', name: `tool_${category}`, message, choices, default: isKnown ? suggested : NONE }])) as unknown as Record<string, string>
  const value = answer[`tool_${category}`]
  return value && value !== NONE ? value : undefined
}

async function pickDesign(render: StepContext['render']): Promise<string[]> {
  const choices = toolsByCategory('design').map((t) => ({ name: t.displayName, value: t.name }))
  const answer = (await render([{ type: 'checkbox', name: 'tool_design', message: 'Design tools (optional, multiple):', choices }])) as unknown as { tool_design?: string[] }
  return Array.isArray(answer.tool_design) ? answer.tool_design : []
}

/** Run + render the per-tool connection check. Never throws, never blocks. */
async function runChecks(selections: ToolSelections, noNetwork: boolean): Promise<void> {
  const targets: Array<{ category: ToolCategory; selection: ToolSelection }> = []
  if (selections.tracker) targets.push({ category: 'tracker', selection: selections.tracker })
  if (selections.docs) targets.push({ category: 'docs', selection: selections.docs })
  for (const d of selections.design ?? []) targets.push({ category: 'design', selection: d })

  if (targets.length === 0) return

  console.log()
  console.log(chalk.gray(noNetwork ? 'Connection checks (offline — credential presence only):' : 'Connection checks:'))
  for (const { category, selection } of targets) {
    const descriptor = findTool(category, selection.name)
    if (!descriptor) continue
    const result = await checkConnection(descriptor, { noNetwork, account: selection.account })
    const badge = result.status === 'ok' ? chalk.green('✓ ok') : chalk.yellow('⚠ warn')
    console.log(`  ${badge} ${chalk.white(descriptor.displayName)} ${chalk.gray(`— ${result.detail}`)}`)
  }
  console.log()
}
