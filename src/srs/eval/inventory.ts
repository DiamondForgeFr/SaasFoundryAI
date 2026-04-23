import { PageRef, SrsAdapter } from '../../builders/srs/types'
import { SrsFrEntry, SrsInventory } from './types'

// FR page titles follow "FR-AREA-NN[-MM] — Title" after SUB-3 / SUB-18.
// parseFrTitle (src/srs/bin/spawn.ts) only handles the legacy "FR-NNN" shape,
// so we ship a dedicated parser here that tolerates both.
const FR_ID_RE = /^(FR-([A-Z0-9]+)(?:-\d+)+)/i

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
  const rest = trimmed.slice(match[0].length).replace(/^\s*[—:\-]\s*/, '')
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
