import { FR_TITLE_SEPARATOR } from '../../constants'
import { FrItem, FrSpec, PageBlock, PageContent, Priority } from '../../types'

const EMPTY_CELL = '—'

function refsCell(refs?: string[]): string {
  return refs && refs.length > 0 ? refs.join(', ') : EMPTY_CELL
}

function priorityCell(priority?: Priority): string {
  return priority ?? EMPTY_CELL
}

function textCell(value?: string): string {
  return value && value.trim().length > 0 ? value : EMPTY_CELL
}

function listCell(items?: string[]): string {
  if (!items || items.length === 0) return EMPTY_CELL
  return items.map((item) => `• ${item}`).join('\n')
}

function summaryRow(fr: FrItem): string[] {
  return [fr.id, fr.title, priorityCell(fr.priority), refsCell(fr.urRefs), refsCell(fr.dsRefs), refsCell(fr.tcRefs)]
}

function detailRows(fr: FrItem): string[][] {
  return [
    ['ID', fr.id],
    ['Title', fr.title],
    ['Endpoint', textCell(fr.endpoint)],
    ['Priority', priorityCell(fr.priority)],
    ['Related UR', refsCell(fr.urRefs)],
    ['Related DS', refsCell(fr.dsRefs)],
    ['Related TC', refsCell(fr.tcRefs)],
    ['Description', textCell(fr.description)],
    ['Request Body', textCell(fr.requestBody)],
    ['Acceptance Criteria', listCell(fr.acceptanceCriteria)],
    ['Validation Rules', listCell(fr.validationRules)],
    ['Security Rationale', textCell(fr.securityRationale)]
  ]
}

export function renderFrPage(spec: FrSpec): PageContent {
  const frs: FrItem[] = [spec.fr]
  const blocks: PageBlock[] = []

  blocks.push({ kind: 'heading', level: 2, text: 'Summary' })
  blocks.push({
    kind: 'table',
    header: ['ID', 'Requirement', 'Priority', 'Related UR', 'Related DS', 'Related TC'],
    rows: frs.map(summaryRow)
  })

  blocks.push({ kind: 'divider' })

  frs.forEach((fr, idx) => {
    blocks.push({ kind: 'heading', level: 2, text: `${fr.id}${FR_TITLE_SEPARATOR}${fr.title}` })
    blocks.push({ kind: 'table', header: ['Field', 'Value'], rows: detailRows(fr) })
    if (idx < frs.length - 1) blocks.push({ kind: 'divider' })
  })

  return { title: `${spec.fr.id}${FR_TITLE_SEPARATOR}${spec.fr.title}`, blocks }
}
