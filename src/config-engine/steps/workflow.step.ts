import chalk from 'chalk'

import { promptWorkflowConfiguration, setupGitHubProjectWithAutoCreation, workflowConfigFromPreset } from '../../prompts/workflow.prompts'
import { WorkflowConfig, WorkflowStatus } from '../../types'
import { assertBoardUrl } from '../../utils/workflow-board'
import { readManifest } from '../../utils'
import { getRemoteUrl } from '../../utils/git-info'
import { ConfigState, StepDefinition } from '../types'

const WORKFLOW_TOOLS = new Set<WorkflowConfig['tool']>(['github-projects', 'jira', 'notion', 'linear', 'none'])

/** A tracker chosen in the tools-first step, when it maps to a workflow tool. */
function asWorkflowTool(tracker?: string): WorkflowConfig['tool'] | undefined {
  return tracker && WORKFLOW_TOOLS.has(tracker as WorkflowConfig['tool']) ? (tracker as WorkflowConfig['tool']) : undefined
}

/**
 * The board of a non-interactive setup (#821). An explicit `--create-board`
 * that fails stops the setup before anything is written: the user asked for a
 * board, and a workflow silently left without one is the defect being fixed.
 */
async function resolveBoard(tool: WorkflowConfig['tool'], board: ConfigState['workflowBoard'], state: ConfigState, statuses: WorkflowStatus[]): Promise<string | undefined> {
  if (board?.projectUrl) return assertBoardUrl(tool, board.projectUrl)
  if (!board?.create) return undefined
  if (tool !== 'github-projects') throw new Error(`--create-board creates a GitHub Projects board, not a ${tool} one: pass --project-url <url>.`)
  // The git remote of the cwd is the project's own only on the harness profile:
  // a stack is generated in a new directory, so its owner comes from the repo URLs
  const repositoryUrl = state.monorepoUrl || state.backendRepoUrl || state.frontendRepoUrl || (state.profile === 'harness' ? getRemoteUrl() : undefined)
  const created = await setupGitHubProjectWithAutoCreation(state.projectName ?? '', statuses, repositoryUrl, { interactive: false })
  if (!created) throw new Error('--create-board: the GitHub Projects board was not created (see the reason above). Fix it and re-run, or attach an existing board with --project-url <url>.')
  return created
}

/**
 * Workflow configuration batch, moved verbatim from
 * `src/prompts/project.prompts.ts`.
 *
 * `promptWorkflowConfiguration` is a wrapped legacy flow: it prompts on its
 * own AND triggers external side effects (GitHub Project auto-creation via
 * `gh api graphql`). The tracker is now chosen once in the tools-first step
 * (FR-CONFIG-ENGINE-04) and threaded here as `preselectedTool`, so the
 * "which tool" question is no longer re-asked.
 */
export const workflowStep: StepDefinition = {
  id: 'workflow',
  title: 'AI workflow',
  effects: ['May create a GitHub Project (4 GraphQL calls through the gh CLI) during collection', 'May save a workflow template to ~/.claude/workflows/'],
  appliesTo: (state) => state.profile !== 'stack',
  collect: async ({ state, prefill, nonInteractive, derived, render }) => {
    // `--no-workflow` / `--workflow none`: no workflow, and no question about one
    if (prefill.workflowDisabled) return {}

    // Non-interactive: use a complete prefilled workflow when supplied. An
    // explicit built-in preset is otherwise materialized here because
    // `buildPrefillFromOptions` intentionally stores only the preset key.
    // A board is attached (`--project-url`) or created (`--create-board`) only
    // when asked; a workflow left without one is reported in the summary.
    if (nonInteractive) {
      if (prefill.workflow) {
        return { workflow: prefill.workflow, aiRules: prefill.aiRules }
      }
      if (prefill.workflowPreset) {
        const tool = asWorkflowTool(derived.selectedTracker) ?? 'github-projects'
        const config = workflowConfigFromPreset(prefill.workflowPreset, tool, prefill.workflowBranches)
        const projectUrl = await resolveBoard(tool, prefill.workflowBoard, state, config.workflow.statuses ?? [])
        return projectUrl ? { ...config, workflow: { ...config.workflow, projectUrl } } : config
      }
      return {}
    }

    console.log()
    console.log(chalk.cyan('🔧 AI Workflow Configuration (Optional)'))
    console.log(chalk.gray('Configure project management tools for AI collaboration (GitHub Projects, Jira, Notion, Linear)'))
    console.log()

    const { configureWorkflow } = (await render([
      {
        type: 'confirm',
        name: 'configureWorkflow',
        message: 'Do you want to configure an AI workflow tool now?',
        default: true
      }
    ])) as unknown as { configureWorkflow?: boolean }

    if (configureWorkflow) {
      // Pass repository URL if available (for GitHub Project creation). The
      // harness profile collects no *RepoUrl (those belong to the stack flow),
      // so fall back to the detected git remote — otherwise auto-creation runs
      // with no owner hint and can't target the right account (#463 finding 3).
      const repositoryUrl = state.monorepoUrl || state.backendRepoUrl || state.frontendRepoUrl || getRemoteUrl()

      // Detect an already-configured board so a re-run reuses it instead of
      // creating a duplicate (#463 finding 5). Best-effort: a fresh project
      // has no manifest yet, so this is undefined and the flow is unchanged.
      const existingManifest = await readManifest(process.cwd())
      // `--project-url` is offered as the board to reuse, so the prompt still confirms it
      const existingProjectUrl = prefill.workflowBoard?.projectUrl ?? existingManifest?.workflow?.projectUrl

      const { workflow, aiRules } = await promptWorkflowConfiguration(
        state.projectName ?? '',
        repositoryUrl,
        prefill.workflowPreset,
        asWorkflowTool(derived.selectedTracker),
        existingProjectUrl,
        prefill.workflowBranches
      )
      return { workflow, aiRules }
    }

    console.log(chalk.gray('You can configure workflow later with: sf workflow create\n'))
    return {}
  },
  decisions: (collected) => (collected.workflow ? [{ stepId: 'workflow', name: 'workflow', value: collected.workflow.tool }] : [{ stepId: 'workflow', name: 'workflow', value: 'none' }])
}
