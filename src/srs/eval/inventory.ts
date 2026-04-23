import { FR_TITLE_SEPARATOR } from '../../builders/srs/constants'
import { PageRef, SrsAdapter } from '../../builders/srs/types'
import { SrsFrEntry, SrsInventory } from './types'

// FR page titles follow `FR-AREA-NN[-MM]${FR_TITLE_SEPARATOR}Title` (em-dash,
// U+2014) produced by `renderFrPage`. The parser accepts the canonical
// separator and tolerates colon or hyphen as fallbacks for resilience against
// manual edits in Notion.
const FR_ID_RE = /^(FR-([A-Z0-9]+)(?:-\d+)+)/i
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
  for (const epic of epics) {
    const children: PageRef[] = await adapter.listChildren(epic.pageId)
    for (const child of children) {
      const parsed = parseFrPageTitle(child.title)
      if (!parsed) continue
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
    unsupportedCategories: ['UR', 'DS', 'TC', 'NFR']
  }
}
