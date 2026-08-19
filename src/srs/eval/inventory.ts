import { FR_TITLE_SEPARATOR } from '../../builders/srs/constants'
import { PageRef, SrsAdapter } from '../../builders/srs/types'
import { SrsFrEntry, SrsInventory } from './types'

// FR page titles follow `FR-AREA-NN[-MM]${FR_TITLE_SEPARATOR}Title` (em-dash,
// U+2014) produced by `renderFrPage`. The parser accepts the canonical
// separator and tolerates colon or hyphen as fallbacks for resilience against
// manual edits in Notion.
// The area may span several hyphen-separated segments (`FR-CONFIG-ENGINE-01`), so each
// segment is required to carry at least one letter. That is what keeps the trailing
// numeric group (`-01`, `-01-02`) out of the area. The previous pattern accepted a single
// alphanumeric segment, so every multi-segment id failed to parse and its page was
// dropped from the inventory without a word — silently deflating every FR total.
const FR_AREA_SEGMENT = '[A-Z0-9]*[A-Z][A-Z0-9]*'
const FR_ID_RE = new RegExp(`^(FR-(${FR_AREA_SEGMENT}(?:-${FR_AREA_SEGMENT})*)(?:-\\d+)+)`, 'i')
const CANONICAL_SEP_CHAR = FR_TITLE_SEPARATOR.trim()
const SEPARATOR_RE = new RegExp(`^\\s*[${CANONICAL_SEP_CHAR}:\\-]\\s*`)

export interface ParsedFrTitle {
  id: string
  area: string
  title: string
}

export function parseFrPageTitle(raw: string): ParsedFrTitle | null {
  const trimmed = raw.trim()
  const match = trimmed.match(FR_ID_RE)
  if (!match) return null
  const id = match[1].toUpperCase()
  const area = match[2].toLowerCase()
  const rest = trimmed.slice(match[0].length).replace(SEPARATOR_RE, '')
  const title = rest.length > 0 ? rest : id
  return { id, area, title }
}

export async function buildSrsInventory(adapter: SrsAdapter, rootPageId: string): Promise<SrsInventory> {
  const epicRefs = await adapter.listChildren(rootPageId)
  const epics = epicRefs.map((ref) => ({ pageId: ref.id, title: ref.title }))
  const frs: SrsFrEntry[] = []
  const unparsedPages: Array<{ pageId: string; title: string; epicTitle: string }> = []
  for (const epic of epics) {
    const children: PageRef[] = await adapter.listChildren(epic.pageId)
    for (const child of children) {
      const parsed = parseFrPageTitle(child.title)
      if (!parsed) {
        unparsedPages.push({ pageId: child.id, title: child.title, epicTitle: epic.title })
        continue
      }
      frs.push({
        id: parsed.id,
        area: parsed.area,
        title: parsed.title,
        pageId: child.id,
        epicPageId: epic.pageId,
        epicTitle: epic.title
      })
    }
  }
  return {
    rootPageId,
    epics,
    frs,
    unsupportedCategories: ['UR', 'DS', 'TC', 'NFR'],
    unparsedPages
  }
}
