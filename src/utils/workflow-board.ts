import { WORKFLOW_PRESETS } from '../prompts/workflow.prompts'
import type { WorkflowConfig } from '../types'

const GITHUB_PROJECT_URL = /^https:\/\/github\.com\/(orgs|users)\/[^/\s]+\/projects\/\d+\/?$/

/**
 * Check a board URL passed as `--project-url` before it reaches the manifest:
 * `github-projects-cli.sh` reads the owner and number out of it, and refuses
 * every command when either is missing.
 */
export function assertBoardUrl(tool: WorkflowConfig['tool'], url: string): string {
  const trimmed = url.trim()
  if (tool === 'github-projects' && !GITHUB_PROJECT_URL.test(trimmed)) {
    throw new Error(`--project-url: ${JSON.stringify(url)} is not a GitHub Projects URL (https://github.com/orgs/<owner>/projects/<number> or https://github.com/users/<owner>/projects/<number>)`)
  }
  if (!trimmed || /\s/.test(trimmed)) throw new Error(`--project-url: ${JSON.stringify(url)} is not a URL`)
  return trimmed
}

/** The `sf workflow use` argument that re-applies the project's current template. */
export function templateArgument(workflow: Pick<WorkflowConfig, 'template'>): string {
  const preset = Object.entries(WORKFLOW_PRESETS).find(([, value]) => value.name === workflow.template)
  return preset?.[0] ?? workflow.template ?? '<template>'
}

/** The next step for a workflow whose tool needs a board and has none (#821). */
export function boardRemediation(workflow: Pick<WorkflowConfig, 'tool' | 'template'>): string {
  const use = `sf workflow use ${templateArgument(workflow)}`
  return workflow.tool === 'github-projects'
    ? `Attach a board with \`${use} --project-url <url>\`, or create one with \`${use} --create-board\`.`
    : `Attach the board with \`${use} --project-url <url>\`.`
}

/** A workflow whose tool tracks tickets on a board, without that board. */
export function isMissingBoard(workflow?: Pick<WorkflowConfig, 'tool' | 'projectUrl'>): boolean {
  return Boolean(workflow?.tool && workflow.tool !== 'none' && !workflow.projectUrl)
}

/** The setup summary's warning for a workflow left without its board, or undefined when it has one. */
export function missingBoardWarning(workflow?: Pick<WorkflowConfig, 'tool' | 'projectUrl' | 'template'>): string | undefined {
  if (!workflow || !isMissingBoard(workflow)) return undefined
  return `No ${workflow.tool} board attached: the workflow scripts refuse ticket commands until one is. ${boardRemediation(workflow)}`
}
