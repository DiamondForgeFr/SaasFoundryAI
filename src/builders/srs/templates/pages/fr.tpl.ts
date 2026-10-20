import { composeFrTitle } from '../../fr-title-format'
import { FrItem, FrSpec, isComplexity, PageBlock, PageContent, Priority, SectionUpdate } from '../../types'
import { changedCells } from './cell-changes'

const EMPTY_CELL = '—'

/** The heading of the first table of an FR page; the reader that amends a page finds it by this text. */
export const FR_SUMMARY_HEADING = 'Summary'

const SUMMARY_HEADER = ['ID', 'Requirement', 'Priority', 'Related UR', 'Related DS', 'Related TC']

/** The labels of the Field/Value table: written by `renderFrPage`, read back by `readFrDetail`. */
const LABELS = {
  id: 'ID',
  title: 'Title',
  endpoint: 'Endpoint',
  priority: 'Priority',
  complexity: 'Complexity',
  urRefs: 'Related UR',
  dsRefs: 'Related DS',
  tcRefs: 'Related TC',
  description: 'Description',
  requestBody: 'Request Body',
  acceptanceCriteria: 'Acceptance Criteria',
  validationRules: 'Validation Rules',
  securityRationale: 'Security Rationale'
} as const

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
    [LABELS.id, fr.id],
    [LABELS.title, fr.title],
    [LABELS.endpoint, textCell(fr.endpoint)],
    [LABELS.priority, priorityCell(fr.priority)],
    [LABELS.complexity, textCell(fr.complexity)],
    [LABELS.urRefs, refsCell(fr.urRefs)],
    [LABELS.dsRefs, refsCell(fr.dsRefs)],
    [LABELS.tcRefs, refsCell(fr.tcRefs)],
    [LABELS.description, textCell(fr.description)],
    [LABELS.requestBody, textCell(fr.requestBody)],
    [LABELS.acceptanceCriteria, listCell(fr.acceptanceCriteria)],
    [LABELS.validationRules, listCell(fr.validationRules)],
    [LABELS.securityRationale, textCell(fr.securityRationale)]
  ]
}

export function renderFrPage(spec: FrSpec): PageContent {
  const frs: FrItem[] = [spec.fr]
  const blocks: PageBlock[] = []

  blocks.push({ kind: 'heading', level: 2, text: FR_SUMMARY_HEADING })
  blocks.push({
    kind: 'table',
    header: SUMMARY_HEADER,
    rows: frs.map(summaryRow)
  })

  blocks.push({ kind: 'divider' })

  frs.forEach((fr, idx) => {
    blocks.push({ kind: 'heading', level: 2, text: composeFrTitle(fr.id, fr.title) })
    blocks.push({ kind: 'table', header: ['Field', 'Value'], rows: detailRows(fr) })
    if (idx < frs.length - 1) blocks.push({ kind: 'divider' })
  })

  return { title: composeFrTitle(spec.fr.id, spec.fr.title), blocks }
}

function readText(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed && trimmed !== EMPTY_CELL ? trimmed : undefined
}

/** `• a\n• b`, the list a cell holds, back to its items. */
function readList(value: string | undefined): string[] {
  const text = readText(value)
  if (!text) return []
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*[•\-*]\s*/, '').trim())
    .filter((line) => line && line !== EMPTY_CELL)
}

function readRefs(value: string | undefined): string[] {
  const text = readText(value)
  if (!text) return []
  return text
    .split(',')
    .map((ref) => ref.trim())
    .filter((ref) => ref && ref !== EMPTY_CELL)
}

/**
 * The FR a page's Field/Value table describes: the inverse of what `renderFrPage` writes there.
 * Only what the table holds is read, and `fallback` stands in for an id or title it lacks.
 */
export function readFrDetail(rows: string[][], fallback: Pick<FrItem, 'id' | 'title'>): FrItem {
  const fields = new Map<string, string>()
  for (const [label, value] of rows.slice(1)) if (label) fields.set(label.trim(), value ?? '')
  const priority = readText(fields.get(LABELS.priority))
  const complexity = readText(fields.get(LABELS.complexity))
  return {
    id: fallback.id,
    title: readText(fields.get(LABELS.title)) ?? fallback.title,
    endpoint: readText(fields.get(LABELS.endpoint)),
    priority: priority === 'P1' || priority === 'P2' || priority === 'P3' ? priority : undefined,
    complexity: isComplexity(complexity) ? complexity : undefined,
    urRefs: readRefs(fields.get(LABELS.urRefs)),
    dsRefs: readRefs(fields.get(LABELS.dsRefs)),
    tcRefs: readRefs(fields.get(LABELS.tcRefs)),
    description: readText(fields.get(LABELS.description)),
    requestBody: readText(fields.get(LABELS.requestBody)),
    acceptanceCriteria: readList(fields.get(LABELS.acceptanceCriteria)),
    validationRules: readList(fields.get(LABELS.validationRules)),
    securityRationale: readText(fields.get(LABELS.securityRationale))
  }
}

/** The headings an FR page carries now: the first names its summary table, the second its detail table. */
export interface FrPageHeadings {
  summary: string
  detail: string
}

/**
 * What an FR page needs to go from `before` to `after`, in place (#945): the cells of its
 * Summary and Field/Value tables that differ, then — when the title changed — its heading and
 * its page title. The cells are written under the headings the page has now, so the detail
 * table is amended before its heading is renamed.
 */
export function frPageUpdates(before: FrItem, after: FrItem, headings: FrPageHeadings): SectionUpdate[] {
  const updates: SectionUpdate[] = []

  const summary = changedCells(SUMMARY_HEADER, summaryRow(before), summaryRow(after))
  if (Object.keys(summary).length > 0) updates.push({ kind: 'table-cells', heading: headings.summary, rowKey: before.id, cells: summary })

  const was = detailRows(before)
  detailRows(after).forEach(([label, value], index) => {
    if (was[index][1] !== value) updates.push({ kind: 'table-cells', heading: headings.detail, rowKey: label, cells: { Value: value } })
  })

  const title = composeFrTitle(after.id, after.title)
  if (composeFrTitle(before.id, before.title) !== title) updates.push({ kind: 'heading', heading: headings.detail, text: title }, { kind: 'title', text: title })
  return updates
}
