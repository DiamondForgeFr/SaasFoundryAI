import { EpicSpec, PageBlock, PageContent } from '../../types'

function refsCell(refs?: string[]): string {
  return refs && refs.length > 0 ? refs.join(', ') : '—'
}

export function renderEpicPage(spec: EpicSpec): PageContent {
  const blocks: PageBlock[] = []

  blocks.push({ kind: 'heading', level: 1, text: 'Overview' })
  if (spec.businessValue) blocks.push({ kind: 'paragraph', text: spec.businessValue })

  if (spec.scope) {
    blocks.push({ kind: 'heading', level: 2, text: 'Scope' })
    blocks.push({ kind: 'paragraph', text: spec.scope })
  }

  blocks.push({ kind: 'divider' })
  blocks.push({ kind: 'heading', level: 2, text: 'Requirement Types' })
  blocks.push({
    kind: 'table',
    header: ['UR', 'FR', 'DS', 'TC'],
    rows: [[String(spec.urs.length), String(spec.frs.length), String(spec.dsItems?.length ?? 0), String(spec.tcItems?.length ?? 0)]]
  })

  blocks.push({ kind: 'heading', level: 2, text: 'Traceability' })
  if (spec.frs.length === 0) {
    blocks.push({ kind: 'paragraph', text: 'No functional requirements yet.' })
  } else {
    blocks.push({
      kind: 'table',
      header: ['FR', 'UR refs', 'DS refs', 'TC refs'],
      rows: spec.frs.map((fr) => [fr.id, refsCell(fr.urRefs), refsCell(fr.dsRefs), refsCell(fr.tcRefs)])
    })
  }

  blocks.push({ kind: 'divider' })
  blocks.push({ kind: 'heading', level: 2, text: 'User Requirements (UR)' })
  if (spec.urs.length === 0) {
    blocks.push({ kind: 'paragraph', text: 'No user requirements yet.' })
  } else {
    blocks.push({
      kind: 'bulleted_list',
      items: spec.urs.map((ur) => {
        const suffix = ur.businessValue ? ` — ${ur.businessValue}` : ''
        return `${ur.id}: ${ur.narrative}${suffix}`
      })
    })
  }

  blocks.push({ kind: 'divider' })
  blocks.push({ kind: 'heading', level: 2, text: 'Functional Requirements (FR)' })
  if (spec.frs.length === 0) {
    blocks.push({ kind: 'paragraph', text: 'No functional requirements yet.' })
  } else {
    for (const fr of spec.frs) {
      blocks.push({ kind: 'heading', level: 3, text: `${fr.id} — ${fr.title}` })
      if (fr.description) blocks.push({ kind: 'paragraph', text: fr.description })
      if (fr.acceptanceCriteria && fr.acceptanceCriteria.length > 0) {
        blocks.push({ kind: 'paragraph', text: 'Acceptance criteria:' })
        blocks.push({ kind: 'bulleted_list', items: fr.acceptanceCriteria })
      }
      blocks.push({
        kind: 'paragraph',
        text: [`UR: ${refsCell(fr.urRefs)}`, `DS: ${refsCell(fr.dsRefs)}`, `TC: ${refsCell(fr.tcRefs)}`].join(' · ')
      })
    }
  }

  return { title: spec.title, blocks }
}
