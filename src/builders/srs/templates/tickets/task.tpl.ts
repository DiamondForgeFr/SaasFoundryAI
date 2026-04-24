import { CompletionCriterion, TaskTicketBodySpec } from '../../types'

function bulletList(items: string[] | undefined, placeholder: string): string {
  if (!items || items.length === 0) return `_${placeholder}_`
  return items.map((item) => `- ${item}`).join('\n')
}

function completionCriteriaTable(criteria: CompletionCriterion[] | undefined): string {
  if (!criteria || criteria.length === 0) return '_No completion criteria yet._'
  const header = ['| CC | Criterion |', '| --- | --- |']
  const rows = criteria.map((cc) => `| ${cc.id} | ${cc.text} |`)
  return [...header, ...rows].join('\n')
}

function specLinksBlock(spec: TaskTicketBodySpec): string {
  const lines: string[] = []
  if (spec.parentEpicUrl) lines.push(`- Parent Epic spec: [${spec.parentEpicUrl}](${spec.parentEpicUrl})`)
  if (spec.parentStoryUrl) lines.push(`- Parent Story spec: [${spec.parentStoryUrl}](${spec.parentStoryUrl})`)
  if (spec.specLinks && spec.specLinks.length > 0) {
    for (const link of spec.specLinks) lines.push(`- ${link.label}: [${link.url}](${link.url})`)
  }
  if (lines.length === 0) return '_Link the SRS pages or external specs this Task implements._'
  return lines.join('\n')
}

export function renderTaskTicketBody(spec: TaskTicketBodySpec): string {
  const sections: string[] = []

  sections.push(`## Objective\n\n${spec.objective ?? `Deliver ${spec.title}.`}`)

  sections.push(`## Context\n\n${spec.context ?? '_Describe the technical motivation or pre-existing state this Task changes._'}`)

  const included = bulletList(spec.scopeIncluded, 'List what is in scope.')
  const excluded = bulletList(spec.scopeExcluded, 'List what is out of scope.')
  sections.push(`## Scope\n\n### Included\n\n${included}\n\n### Excluded\n\n${excluded}`)

  sections.push(`## Completion Criteria\n\n${completionCriteriaTable(spec.completionCriteria)}`)

  sections.push(`## Specifications\n\n${specLinksBlock(spec)}`)

  sections.push(`## Dependencies\n\n${bulletList(spec.dependencies, 'List upstream tickets or services this Task depends on.')}`)

  sections.push(`## Constraints\n\n${bulletList(spec.constraints, 'List technical or business constraints.')}`)

  return sections.join('\n\n')
}
