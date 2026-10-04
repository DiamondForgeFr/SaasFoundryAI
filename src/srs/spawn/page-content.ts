import { Complexity, isComplexity, Priority, RawContent } from '../../builders/srs/types'

/**
 * Reads back what `sf srs write` put on an FR page and on a feature or version page, so the
 * tickets spawn creates carry the SRS instead of placeholders (#837). It reads the layout
 * the page renderers write — the FR page's Field/Value table, the epic page's sections and
 * tables — and takes nothing it cannot find: a hand-edited page yields fewer fields, never
 * invented ones.
 */

const EMPTY = '—'

type RawBlock = RawContent['blocks'][number]

interface Section {
  heading: string
  blocks: RawBlock[]
}

/** The page's blocks grouped under the heading that precedes them (the leading ones under ''). */
function sectionsOf(raw: RawContent): Section[] {
  const sections: Section[] = [{ heading: '', blocks: [] }]
  for (const block of raw.blocks) {
    if (block.kind === 'heading') sections.push({ heading: block.text.trim(), blocks: [] })
    else sections[sections.length - 1].blocks.push(block)
  }
  return sections
}

function section(raw: RawContent, heading: string): Section | undefined {
  const wanted = heading.toLowerCase()
  return sectionsOf(raw).find((candidate) => candidate.heading.toLowerCase() === wanted)
}

function text(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed && trimmed !== EMPTY ? trimmed : undefined
}

function paragraphs(found: Section | undefined): string | undefined {
  return text(
    found?.blocks
      .filter((block) => block.kind === 'paragraph')
      .map((block) => block.text)
      .join('\n\n')
  )
}

function listItems(found: Section | undefined): string[] {
  return (found?.blocks ?? [])
    .filter((block) => block.kind === 'list')
    .map((block) => block.text.trim())
    .filter(Boolean)
}

/** `• a\n• b` — a list written into one table cell. */
function cellList(value: string | undefined): string[] {
  if (!text(value)) return []
  return value!
    .split('\n')
    .map((line) => line.replace(/^\s*[•\-*]\s*/, '').trim())
    .filter((line) => line && line !== EMPTY)
}

/** `UR-1, UR-2` — references written into one table cell. */
function cellRefs(value: string | undefined): string[] {
  if (!text(value)) return []
  return value!
    .split(',')
    .map((ref) => ref.trim())
    .filter((ref) => ref && ref !== EMPTY)
}

/** Data rows of the first table in a section, header dropped and group header rows skipped. */
function tableRows(found: Section | undefined): string[][] {
  const table = found?.blocks.find((block) => block.kind === 'table')
  return (table?.rows ?? []).slice(1).filter((row) => row.slice(1).some((cell) => cell.trim() !== ''))
}

export interface FrPageContent {
  description?: string
  priority?: Priority
  complexity?: Complexity
  acceptanceCriteria: string[]
  urRefs: string[]
  dsRefs: string[]
  tcRefs: string[]
  validationRules: string[]
  securityRationale?: string
}

/** The FR page's Field/Value table, under the heading that names the FR. */
export function parseFrPage(raw: RawContent): FrPageContent {
  const fields = new Map<string, string>()
  for (const block of raw.blocks) {
    if (block.kind !== 'table' || !block.rows || block.rows[0]?.[0]?.trim() !== 'Field') continue
    for (const [label, value] of block.rows.slice(1)) if (label) fields.set(label.trim(), value ?? '')
  }
  const priority = text(fields.get('Priority'))
  const complexity = text(fields.get('Complexity'))
  return {
    description: text(fields.get('Description')),
    priority: priority === 'P1' || priority === 'P2' || priority === 'P3' ? priority : undefined,
    complexity: isComplexity(complexity) ? complexity : undefined,
    acceptanceCriteria: cellList(fields.get('Acceptance Criteria')),
    urRefs: cellRefs(fields.get('Related UR')),
    dsRefs: cellRefs(fields.get('Related DS')),
    tcRefs: cellRefs(fields.get('Related TC')),
    validationRules: cellList(fields.get('Validation Rules')),
    securityRationale: text(fields.get('Security Rationale'))
  }
}

export interface EpicPageContent {
  businessValue?: string
  scope?: string
  /** "What changed in this version", on a version page. */
  changes: string[]
  /** UR id → narrative, from the feature page's UR table. */
  urs: Map<string, string>
  /** DS id → title, from the feature page's DS table. */
  ds: Map<string, string>
}

/** A feature or version page: its intent sections, what changed, and its UR and DS tables. */
export function parseEpicPage(raw: RawContent): EpicPageContent {
  return {
    businessValue: paragraphs(section(raw, 'Business Value')),
    scope: paragraphs(section(raw, 'Scope')),
    changes: listItems(section(raw, 'What changed in this version')),
    urs: new Map(tableRows(section(raw, 'User Requirements (UR)')).map((row) => [row[0].trim(), row[1]?.trim() ?? ''])),
    ds: new Map(tableRows(section(raw, 'Design Specifications (DS)')).map((row) => [row[0].trim(), row[1]?.trim() ?? '']))
  }
}
