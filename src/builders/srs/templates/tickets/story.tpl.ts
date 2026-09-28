import { AcceptanceCriterion, DsRef, StoryTicketBodySpec, UrItem } from '../../types'

function bulletList(items: string[] | undefined, placeholder: string): string {
  if (!items || items.length === 0) return `_${placeholder}_`
  return items.map((item) => `- ${item}`).join('\n')
}

function urRefsList(refs: UrItem[] | undefined): string {
  if (!refs || refs.length === 0) return '_No UR references yet._'
  return refs.map((ur) => `- **${ur.id}** — ${ur.narrative}`).join('\n')
}

function frRefsList(refs: StoryTicketBodySpec['frRefs'], currentFrId: string): string {
  const resolved = refs && refs.length > 0 ? refs : [{ id: currentFrId }]
  return resolved.map((fr) => `- **${fr.id}**${fr.title ? ` — ${fr.title}` : ''}`).join('\n')
}

function acceptanceCriteriaTable(criteria: AcceptanceCriterion[] | undefined): string {
  if (!criteria || criteria.length === 0) return '_No acceptance criteria yet._'
  const header = ['| AC | Criterion | Source FR |', '| --- | --- | --- |']
  const rows = criteria.map((ac) => `| ${ac.id} | ${ac.text} | ${ac.sourceFr ?? '—'} |`)
  return [...header, ...rows].join('\n')
}

function dsRefsList(refs: DsRef[] | undefined): string {
  if (!refs || refs.length === 0) return '_No design references yet._'
  return refs.map((ds) => `- **${ds.id}**${ds.title ? ` — ${ds.title}` : ''}`).join('\n')
}

function specReferenceBlock(spec: StoryTicketBodySpec): string {
  const lines: string[] = []
  if (spec.frPageUrl) lines.push(`- FR page: [${spec.fr.id} — ${spec.fr.title}](${spec.frPageUrl})`)
  else lines.push(`- FR page: _Link the FR SRS page here once the spec is published._`)
  if (spec.mainSpecUrl) lines.push(`- Epic spec: [${spec.mainSpecUrl}](${spec.mainSpecUrl})`)
  return lines.join('\n')
}

export function renderStoryTicketBody(spec: StoryTicketBodySpec): string {
  const { fr } = spec
  const sections: string[] = []

  sections.push(`## Objective\n\n${fr.description ?? `Implement ${fr.id} — ${fr.title}.`}`)

  sections.push(`## Context (User Requirements)\n\n${urRefsList(spec.urRefs)}`)

  sections.push(`## Scope (Functional Requirements)\n\n${frRefsList(spec.frRefs, fr.id)}`)

  sections.push(`## Acceptance Criteria\n\n${acceptanceCriteriaTable(spec.acceptanceCriteria)}`)

  sections.push(`## Specifications\n\n${specReferenceBlock(spec)}`)

  sections.push(`## Dependencies\n\n${bulletList(spec.dependencies, 'List upstream tickets or services this Story depends on.')}`)

  sections.push(`## Constraints\n\n${bulletList(spec.constraints, 'List technical or business constraints.')}`)

  sections.push(`## Design References\n\n${dsRefsList(spec.dsRefs)}`)

  return sections.join('\n\n')
}
