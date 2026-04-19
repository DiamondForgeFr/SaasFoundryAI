import type { BlockObjectRequest } from '@notionhq/client'

import { EpicSpec, FrItem, FrSpec, UrItem } from '../../builders/srs/types'

type ParagraphBlock = Extract<BlockObjectRequest, { paragraph: { rich_text: unknown } }>
type TableBlock = Extract<BlockObjectRequest, { table: { table_width: unknown } }>
type TableRowChild = TableBlock['table']['children'][number]
type RichTextItemRequest = ParagraphBlock['paragraph']['rich_text'][number]

function rt(text: string): RichTextItemRequest[] {
  if (!text) return []
  return [{ type: 'text', text: { content: text } }]
}

function heading(level: 1 | 2 | 3, text: string): BlockObjectRequest {
  if (level === 1) return { type: 'heading_1', heading_1: { rich_text: rt(text) } }
  if (level === 2) return { type: 'heading_2', heading_2: { rich_text: rt(text) } }
  return { type: 'heading_3', heading_3: { rich_text: rt(text) } }
}

function paragraph(text: string): BlockObjectRequest {
  return { type: 'paragraph', paragraph: { rich_text: rt(text) } }
}

function bulleted(text: string): BlockObjectRequest {
  return { type: 'bulleted_list_item', bulleted_list_item: { rich_text: rt(text) } }
}

function divider(): BlockObjectRequest {
  return { type: 'divider', divider: {} }
}

function tableRow(cells: string[]): TableRowChild {
  return { type: 'table_row', table_row: { cells: cells.map(rt) } }
}

function table(header: string[], rows: string[][]): BlockObjectRequest {
  return {
    type: 'table',
    table: {
      table_width: header.length,
      has_column_header: true,
      has_row_header: false,
      children: [tableRow(header), ...rows.map(tableRow)]
    }
  }
}

function refsLine(label: string, refs?: string[]): string {
  if (!refs || refs.length === 0) return `${label}: —`
  return `${label}: ${refs.join(', ')}`
}

function renderUrList(urs: UrItem[]): BlockObjectRequest[] {
  if (urs.length === 0) return [paragraph('No user requirements yet.')]
  return urs.map((ur) => {
    const suffix = ur.businessValue ? ` — ${ur.businessValue}` : ''
    return bulleted(`${ur.id}: ${ur.narrative}${suffix}`)
  })
}

function renderFrDetail(fr: FrItem): BlockObjectRequest[] {
  const blocks: BlockObjectRequest[] = [heading(3, `${fr.id} — ${fr.title}`)]
  if (fr.description) blocks.push(paragraph(fr.description))
  if (fr.acceptanceCriteria && fr.acceptanceCriteria.length > 0) {
    blocks.push(paragraph('Acceptance criteria:'))
    for (const ac of fr.acceptanceCriteria) blocks.push(bulleted(ac))
  }
  blocks.push(paragraph([refsLine('UR', fr.urRefs), refsLine('DS', fr.dsRefs), refsLine('TC', fr.tcRefs)].join(' · ')))
  return blocks
}

export function buildEpicPageBlocks(spec: EpicSpec): BlockObjectRequest[] {
  const blocks: BlockObjectRequest[] = []

  blocks.push(heading(1, 'Overview'))
  if (spec.businessValue) blocks.push(paragraph(spec.businessValue))

  if (spec.scope) {
    blocks.push(heading(2, 'Scope'))
    blocks.push(paragraph(spec.scope))
  }

  blocks.push(divider())
  blocks.push(heading(2, 'Requirement Types'))
  blocks.push(table(['UR', 'FR', 'DS', 'TC'], [[String(spec.urs.length), String(spec.frs.length), String(spec.dsItems?.length ?? 0), String(spec.tcItems?.length ?? 0)]]))

  blocks.push(heading(2, 'Traceability'))
  if (spec.frs.length === 0) {
    blocks.push(paragraph('No functional requirements yet.'))
  } else {
    blocks.push(
      table(
        ['FR', 'UR refs', 'DS refs', 'TC refs'],
        spec.frs.map((fr) => [fr.id, (fr.urRefs ?? []).join(', ') || '—', (fr.dsRefs ?? []).join(', ') || '—', (fr.tcRefs ?? []).join(', ') || '—'])
      )
    )
  }

  blocks.push(divider())
  blocks.push(heading(2, 'User Requirements (UR)'))
  blocks.push(...renderUrList(spec.urs))

  blocks.push(divider())
  blocks.push(heading(2, 'Functional Requirements (FR)'))
  if (spec.frs.length === 0) {
    blocks.push(paragraph('No functional requirements yet.'))
  } else {
    for (const fr of spec.frs) blocks.push(...renderFrDetail(fr))
  }

  return blocks
}

export function buildFrPageBlocks(spec: FrSpec): BlockObjectRequest[] {
  const { fr } = spec
  const blocks: BlockObjectRequest[] = []

  blocks.push(heading(1, `${fr.id} — ${fr.title}`))
  if (fr.description) blocks.push(paragraph(fr.description))

  blocks.push(heading(2, 'User Requirements'))
  if (!spec.urs || spec.urs.length === 0) {
    blocks.push(paragraph('No linked user requirements.'))
  } else {
    for (const ur of spec.urs) blocks.push(bulleted(`${ur.id}: ${ur.narrative}`))
  }

  blocks.push(heading(2, 'Acceptance Criteria'))
  if (!fr.acceptanceCriteria || fr.acceptanceCriteria.length === 0) {
    blocks.push(paragraph('No acceptance criteria yet.'))
  } else {
    for (const ac of fr.acceptanceCriteria) blocks.push(bulleted(ac))
  }

  blocks.push(heading(2, 'Design (DS)'))
  if (!spec.dsItems || spec.dsItems.length === 0) {
    blocks.push(paragraph('No design items yet.'))
  } else {
    for (const ds of spec.dsItems) blocks.push(bulleted(`${ds.id}: ${ds.title}`))
  }

  blocks.push(heading(2, 'Test Cases (TC)'))
  if (!spec.tcItems || spec.tcItems.length === 0) {
    blocks.push(paragraph('No test cases yet.'))
  } else {
    for (const tc of spec.tcItems) blocks.push(bulleted(`${tc.id}: ${tc.title}`))
  }

  return blocks
}
