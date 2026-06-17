import chalk from 'chalk'

import { promptWorkflowConfiguration } from '../../prompts/workflow.prompts'
import { WorkflowConfig } from '../../types'
import { StepDefinition } from '../types'

const WORKFLOW_TOOLS = new Set<WorkflowConfig['tool']>(['github-projects', 'jira', 'notion', 'linear', 'none'])

/** A tracker chosen in the tools-first step, when it maps to a workflow tool. */
function asWorkflowTool(tracker?: string): WorkflowConfig['tool'] | undefined {
  return tracker && WORKFLOW_TOOLS.has(tracker as WorkflowConfig['tool']) ? (tracker as WorkflowConfig['tool']) : undefined
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
    // Non-interactive: use prefilled workflow if provided, otherwise skip (tool = 'none')
    if (nonInteractive) {
      if (prefill.workflow) {
        return { workflow: prefill.workflow, aiRules: prefill.aiRules }
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
      // Pass repository URL if available (for GitHub Project creation)
      const repositoryUrl = state.monorepoUrl || state.backendRepoUrl || state.frontendRepoUrl

      const { workflow, aiRules } = await promptWorkflowConfiguration(state.projectName ?? '', repositoryUrl, prefill.workflowPreset, asWorkflowTool(derived.selectedTracker))
      return { workflow, aiRules }
    }

    console.log(chalk.gray('You can configure workflow later with: sf workflow create\n'))
    return {}
  },
  decisions: (collected) => (collected.workflow ? [{ stepId: 'workflow', name: 'workflow', value: collected.workflow.tool }] : [{ stepId: 'workflow', name: 'workflow', value: 'none' }])
}
