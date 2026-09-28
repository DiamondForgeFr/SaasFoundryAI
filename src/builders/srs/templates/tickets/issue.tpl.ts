import { IssueTicketBodySpec } from '../../types'

function bulletList(items: string[] | undefined, placeholder: string): string {
  if (!items || items.length === 0) return `_${placeholder}_`
  return items.map((item) => `- ${item}`).join('\n')
}

function numberedList(items: string[] | undefined, placeholder: string): string {
  if (!items || items.length === 0) return `_${placeholder}_`
  return items.map((item, index) => `${index + 1}. ${item}`).join('\n')
}

function impactBlock(spec: IssueTicketBodySpec): string {
  const lines: string[] = []
  if (spec.severity) lines.push(`**Severity:** ${spec.severity}`)
  if (spec.impact) lines.push(spec.impact)
  if (lines.length === 0) return '_Describe who/what is affected and how severely._'
  return lines.join('\n\n')
}

export function renderIssueTicketBody(spec: IssueTicketBodySpec): string {
  const sections: string[] = []

  sections.push(`## Behavior observed\n\n${spec.behaviorObserved ?? '_Describe the actual buggy behavior._'}`)

  sections.push(`## Expected Behavior\n\n${spec.expectedBehavior ?? '_Describe what should happen instead._'}`)

  sections.push(`## Steps to Reproduce / Trigger Conditions\n\n${numberedList(spec.stepsToReproduce, 'List the steps or conditions that trigger the bug.')}`)

  sections.push(`## Environment / Configuration\n\n${bulletList(spec.environment, 'List relevant environment details (OS, browser, version, flags…).')}`)

  sections.push(`## Impact / Severity\n\n${impactBlock(spec)}`)

  sections.push(`## Evidence / Data\n\n${bulletList(spec.evidence, 'Attach logs, screenshots, or stack traces here.')}`)

  return sections.join('\n\n')
}
