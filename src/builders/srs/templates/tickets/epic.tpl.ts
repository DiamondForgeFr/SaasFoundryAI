import { EpicTicketBodySpec, FrPageLink } from '../../types'

function bulletList(items: string[] | undefined, placeholder: string): string {
  if (!items || items.length === 0) return `_${placeholder}_`
  return items.map((item) => `- ${item}`).join('\n')
}

function frPagesTable(pages: FrPageLink[] | undefined): string {
  if (!pages || pages.length === 0) return '_No FR pages linked yet._'
  const header = ['| FR | Title | Page |', '| --- | --- | --- |']
  const rows = pages.map((p) => {
    const link = p.pageUrl ? `[${p.frTitle}](${p.pageUrl})` : '—'
    return `| ${p.frId} | ${p.frTitle} | ${link} |`
  })
  return [...header, ...rows].join('\n')
}

function specReferenceLine(epicPageUrl: string | undefined): string {
  if (!epicPageUrl) return '_Link the Epic SRS page here once the spec is published._'
  return `Main spec: [Epic SRS page](${epicPageUrl})`
}

export function renderEpicTicketBody(spec: EpicTicketBodySpec): string {
  const { epic } = spec
  const sections: string[] = []

  sections.push(`## Goal\n\n${epic.title}`)

  sections.push(`## Business Value\n\n${epic.businessValue ?? '_Describe the business impact of this Epic._'}`)

  const included = bulletList(spec.scopeIncluded, 'List what is in scope.')
  const excluded = bulletList(spec.scopeExcluded, 'List what is out of scope.')
  sections.push(`## Scope\n\n### Included\n\n${included}\n\n### Excluded\n\n${excluded}`)

  const specRef = specReferenceLine(spec.epicPageUrl)
  const frTable = frPagesTable(spec.frPages)
  sections.push(`## Specifications\n\n${specRef}\n\n${frTable}`)

  sections.push(`## Dependencies\n\n${bulletList(spec.dependencies, 'List upstream tickets or services this Epic depends on.')}`)

  sections.push(`## Constraints\n\n${bulletList(spec.constraints, 'List technical or business constraints.')}`)

  sections.push(`## Assumptions\n\n${bulletList(spec.assumptions, 'List assumptions made while drafting this Epic.')}`)

  sections.push(`## Definition of Done\n\n${bulletList(spec.definitionOfDone, 'List the exit criteria for this Epic.')}`)

  return sections.join('\n\n')
}
