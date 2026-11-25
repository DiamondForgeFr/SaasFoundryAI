import { PageRef, PageScan, RawContent, SrsAdapter } from '../../../builders/srs/types'
import { describeHeldIds, describeNextIds, nextFreeIds, readFeatureRegister } from '../../../srs/feature-register'

type Block = RawContent['blocks'][number]

const heading = (text: string): Block => ({ kind: 'heading', text })
const list = (text: string): Block => ({ kind: 'list', text })
const paragraph = (text: string): Block => ({ kind: 'paragraph', text })
const table = (rows: string[][]): Block => ({ kind: 'table', text: '', rows })

interface FakePage {
  title: string
  blocks: Block[]
  children?: string[]
}

/**
 * A fictional library app (#991). The tables of its "Book loans" feature list only what v2
 * brought. The ids of v1 live elsewhere: in the cells of an FR page, in a section appended to
 * it, in a section appended to the feature page, in the version page's own table, and on a page
 * below the FR page.
 */
const PAGES: Record<string, FakePage> = {
  feature: {
    title: 'Book loans',
    children: ['v1', 'v2'],
    blocks: [
      heading('Versions'),
      list('v1 — Borrow and return'),
      list('v2 — Renewals'),
      heading('Requirement Types'),
      table([
        ['Prefix', 'Type', 'Description', 'Example'],
        ['UR', 'User Requirement', 'High-level user need', 'UR-SAMPLE-001']
      ]),
      heading('User Requirements (UR)'),
      table([
        ['ID', 'Requirement', 'Version', 'Priority', 'Related FR'],
        ['UR-LOAN-006', 'A reader keeps a book two more weeks', 'v2 — Renewals', 'P1', 'FR-LOAN-014']
      ]),
      heading('Design Specifications (DS)'),
      table([
        ['ID', 'Specification', 'Version', 'Description', 'Related FR'],
        ['DS-LOAN-018', 'Renewal counter', 'v2 — Renewals', 'Two renewals at most', 'FR-LOAN-014']
      ]),
      heading('Non-Functional Requirements (NFR)'),
      paragraph('No non-functional requirements yet.'),
      heading('Added User Requirement — UR-LOAN-003'),
      list('UR-LOAN-003: As a librarian, I see which books are late.')
    ]
  },
  v1: {
    title: 'v1 — Borrow and return',
    children: ['fr-001'],
    blocks: [
      paragraph('FR-LOAN-001 reads the card described by DS-MEMBER-045 of the Memberships feature.'),
      heading('Functional Requirements (FR)'),
      table([
        ['ID', 'Requirement', 'Priority'],
        ['FR-LOAN-001', 'Borrow a book', 'P1'],
        ['FR-LOAN-002', 'Return a book', 'P1']
      ]),
      heading('Non-Functional Requirements (NFR)'),
      table([
        ['ID', 'Requirement', 'Target'],
        ['NFR-LOAN-004', 'The desk answers quickly', 'One second']
      ])
    ]
  },
  v2: {
    title: 'v2 — Renewals',
    children: ['fr-014'],
    blocks: [
      heading('Functional Requirements (FR)'),
      table([
        ['ID', 'Requirement', 'Priority'],
        ['FR-LOAN-014', 'Renew a loan', 'P1']
      ])
    ]
  },
  'fr-001': {
    title: 'FR-LOAN-001 — Borrow a book',
    children: ['notes-001'],
    blocks: [
      heading('Summary'),
      table([
        ['ID', 'Requirement', 'Priority', 'Related UR', 'Related DS', 'Related TC'],
        ['FR-LOAN-001', 'Borrow a book', 'P1', 'UR-LOAN-001, UR-LOAN-002', 'DS-LOAN-001', 'TC-LOAN-025-1']
      ]),
      table([
        ['Field', 'Value'],
        ['ID', 'FR-LOAN-001'],
        ['Acceptance Criteria', '• Meets NFR-LOAN-002']
      ]),
      heading('Added Design Item — DS-LOAN-017'),
      list('DS-LOAN-017: The desk scans the card before the book.')
    ]
  },
  'fr-014': {
    title: 'FR-LOAN-014 — Renew a loan',
    blocks: [
      heading('Summary'),
      table([
        ['ID', 'Requirement', 'Priority', 'Related UR', 'Related DS', 'Related TC'],
        ['FR-LOAN-014', 'Renew a loan', 'P1', 'UR-LOAN-006', 'DS-LOAN-018', '—']
      ])
    ]
  },
  'notes-001': { title: 'Desk notes', blocks: [paragraph('The test on torn cards is TC-LOAN-031.')] }
}

const refsOf = (pages: Record<string, FakePage>, pageId: string): PageRef[] => (pages[pageId]?.children ?? []).map((id) => ({ id, url: '', title: pages[id]?.title ?? id }))

function fakeAdapter(pages = PAGES): SrsAdapter & { fetched: string[] } {
  const fetched: string[] = []
  return {
    fetched,
    fetchPage: async (pageId: string) => {
      fetched.push(pageId)
      const page = pages[pageId]
      if (!page) throw new Error(`no page ${pageId}`)
      return { pageId, title: page.title, url: '', blocks: page.blocks }
    },
    listChildren: async (pageId: string) => refsOf(pages, pageId)
  } as unknown as SrsAdapter & { fetched: string[] }
}

// #991 — next-ids said "none yet", and write let a batch reuse ids the feature's pages held
describe('readFeatureRegister', () => {
  it('reads the feature page, the version pages, the FR pages and the pages below them, once each', async () => {
    const adapter = fakeAdapter()
    await readFeatureRegister(adapter, 'feature')
    expect([...adapter.fetched].sort()).toEqual(['feature', 'fr-001', 'fr-014', 'notes-001', 'v1', 'v2'])
  })

  it('holds the ids written only in FR pages, appended sections, version tables and pages below an FR', async () => {
    const register = await readFeatureRegister(fakeAdapter(), 'feature')
    expect([...register.ids.UR].sort()).toEqual(['UR-LOAN-001', 'UR-LOAN-002', 'UR-LOAN-003', 'UR-LOAN-006'])
    expect([...register.ids.DS].sort()).toEqual(['DS-LOAN-001', 'DS-LOAN-017', 'DS-LOAN-018', 'DS-MEMBER-045'])
    expect([...register.ids.NFR].sort()).toEqual(['NFR-LOAN-002', 'NFR-LOAN-004'])
    expect([...register.ids.FR].sort()).toEqual(['FR-LOAN-001', 'FR-LOAN-002', 'FR-LOAN-014'])
    expect(register.ids.TC).toContain('TC-LOAN-031')
  })

  it('holds a sub-numbered test case and the number it hangs from', async () => {
    const register = await readFeatureRegister(fakeAdapter(), 'feature')
    expect([...register.ids.TC].sort()).toEqual(['TC-LOAN-025', 'TC-LOAN-025-1', 'TC-LOAN-031'])
  })

  it('never reads the primer table of requirement types as requirements', async () => {
    const register = await readFeatureRegister(fakeAdapter(), 'feature')
    expect(register.ids.UR.has('UR-SAMPLE-001')).toBe(false)
    expect(register.ids.UR.has('UR-LOAN-006')).toBe(true)
    expect(register.ids.UR.has('UR-LOAN-001')).toBe(true)
  })

  it('reads the first row of a table without a header row', async () => {
    const pages = { ...PAGES, v2: { ...PAGES.v2, blocks: [table([['TC-LOAN-040', 'Renew twice']])] } }
    expect((await readFeatureRegister(fakeAdapter(pages), 'feature')).ids.TC).toContain('TC-LOAN-040')
  })

  it('names the page of each id no row or title defines', async () => {
    const { mentions } = await readFeatureRegister(fakeAdapter(), 'feature')
    expect(Object.fromEntries(mentions)).toEqual({
      'UR-LOAN-001': 'FR-LOAN-001 — Borrow a book',
      'UR-LOAN-002': 'FR-LOAN-001 — Borrow a book',
      'UR-LOAN-003': 'the feature page',
      'DS-LOAN-001': 'FR-LOAN-001 — Borrow a book',
      'DS-LOAN-017': 'FR-LOAN-001 — Borrow a book',
      'DS-MEMBER-045': 'v1 — Borrow and return',
      'TC-LOAN-025': 'FR-LOAN-001 — Borrow a book',
      'TC-LOAN-025-1': 'FR-LOAN-001 — Borrow a book',
      'TC-LOAN-031': 'Desk notes',
      'NFR-LOAN-002': 'FR-LOAN-001 — Borrow a book'
    })
  })

  it('tells the FRs a version lists while no page carries them', async () => {
    const { announcedFrs } = await readFeatureRegister(fakeAdapter(), 'feature')
    expect(announcedFrs.get('v1')).toEqual(new Set(['FR-LOAN-002']))
    expect(announcedFrs.get('v2')).toEqual(new Set())
  })

  it('fails when a page cannot be read, rather than return a register missing its ids', async () => {
    const { 'fr-014': missing, ...pages } = PAGES
    expect(missing).toBeDefined()
    await expect(readFeatureRegister(fakeAdapter(pages), 'feature')).rejects.toThrow('no page fr-014')
  })

  it('reads three pages at a time at most', async () => {
    const children = Array.from({ length: 10 }, (_, index) => `extra-${index}`)
    const pages: Record<string, FakePage> = { feature: { title: 'Book loans', children: ['v1'], blocks: [] }, v1: { title: 'v1 — Borrow and return', children, blocks: [] } }
    for (const id of children) pages[id] = { title: id, blocks: [] }
    let reading = 0
    let most = 0
    const adapter = {
      scanPage: async (pageId: string): Promise<PageScan> => {
        most = Math.max(most, ++reading)
        await new Promise((resolve) => setImmediate(resolve))
        reading--
        return { blocks: pages[pageId].blocks, childPages: refsOf(pages, pageId) }
      }
    } as unknown as SrsAdapter
    await readFeatureRegister(adapter, 'feature')
    expect(most).toBe(3)
  })

  it('reads a backend that scans pages with that one call per page', async () => {
    const scanned: string[] = []
    const adapter = {
      scanPage: async (pageId: string): Promise<PageScan> => {
        scanned.push(pageId)
        return { blocks: [...PAGES[pageId].blocks, ...(pageId === 'fr-014' ? [{ kind: 'other' as const, text: 'In a callout: TC-LOAN-052' }] : [])], childPages: refsOf(PAGES, pageId) }
      }
    } as unknown as SrsAdapter
    const register = await readFeatureRegister(adapter, 'feature')
    expect([...scanned].sort()).toEqual(['feature', 'fr-001', 'fr-014', 'notes-001', 'v1', 'v2'])
    expect(register.versionTitles).toEqual(['v1 — Borrow and return', 'v2 — Renewals'])
    expect(nextFreeIds(register).TC).toEqual(['TC-LOAN-053'])
  })
})

describe('describeHeldIds', () => {
  it('says where an id without a row of its own was found, and how to keep it', async () => {
    const register = await readFeatureRegister(fakeAdapter(), 'feature')
    const held = describeHeldIds(register, [
      ['UR', 'UR-LOAN-006'],
      ['DS', 'ds-loan-017'],
      ['DS', 'DS-MEMBER-045'],
      ['TC', 'TC-LOAN-099']
    ])
    expect(held.clashes).toEqual(['UR-LOAN-006', 'DS-LOAN-017 (no row of its own, found on "FR-LOAN-001 — Borrow a book")', 'DS-MEMBER-045 (no row of its own, found on "v1 — Borrow and return")'])
    expect(held.note).toContain('sf srs apply-update')
  })

  it('adds no note when every held id has its row', async () => {
    const register = await readFeatureRegister(fakeAdapter(), 'feature')
    expect(describeHeldIds(register, [['UR', 'UR-LOAN-006']])).toEqual({ clashes: ['UR-LOAN-006'], note: '' })
  })
})

describe('nextFreeIds', () => {
  it('proposes the number after the highest one any page holds, in the feature own areas only', async () => {
    const register = await readFeatureRegister(fakeAdapter(), 'feature')
    expect(register.areas).toEqual(new Set(['LOAN']))
    expect(nextFreeIds(register)).toEqual({ UR: ['UR-LOAN-007'], FR: ['FR-LOAN-015'], DS: ['DS-LOAN-019'], TC: ['TC-LOAN-032'], NFR: ['NFR-LOAN-005'] })
  })

  it('does not take for its own the area of ids a table of another kind lists', async () => {
    const dependencies = table([
      ['Needs', 'Why'],
      ['DS-MEMBER-045', 'The card']
    ])
    const pages = { ...PAGES, feature: { ...PAGES.feature, blocks: [...PAGES.feature.blocks, dependencies] } }
    expect(nextFreeIds(await readFeatureRegister(fakeAdapter(pages), 'feature')).DS).toEqual(['DS-LOAN-019'])
  })

  it('gives every area for a feature that defines no id yet', async () => {
    const pages = { feature: { title: 'Book loans', blocks: [paragraph('Starts from UR-LOAN-002.')] } }
    const register = await readFeatureRegister(fakeAdapter(pages), 'feature')
    expect(nextFreeIds(register).UR).toEqual(['UR-LOAN-003'])
    expect(describeNextIds(register)).toBe('next version: v1; next ids: UR-LOAN-003')
  })
})
