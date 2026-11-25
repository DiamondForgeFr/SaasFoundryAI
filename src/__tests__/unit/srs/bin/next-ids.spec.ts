import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { PageRef, RawContent, ResolvedParent, SrsAdapter } from '../../../../builders/srs/types'
import { registerSrsBackend, unregisterSrsBackend } from '../../../../srs'
import { SrsUsageError } from '../../../../srs/bin/args'
import { parseArgs, runNextIds } from '../../../../srs/bin/next-ids'

// #919 — the numbers to use, read from the SRS rather than from an earlier reading
describe('sf srs next-ids', () => {
  const adapter = {
    init: async () => {},
    resolveParent: async (input: string): Promise<ResolvedParent> => ({ id: 'feature', name: 'Réunion live', url: input }),
    listChildren: async (parent: string): Promise<PageRef[]> =>
      parent === 'feature'
        ? [
            { id: 'v1', url: '', title: 'v1 — First' },
            { id: 'v2', url: '', title: 'v2 — Second' }
          ]
        : parent === 'v2'
          ? [{ id: 'fr', url: '', title: 'FR-LIVE-009 — Late' }]
          : [],
    fetchPage: async (pageId: string): Promise<RawContent> => ({
      pageId,
      title: 'Réunion live',
      url: '',
      blocks: [
        // #991 — an id only the FR page holds, in a Related cell, still counts
        ...(pageId === 'fr'
          ? [
              {
                kind: 'table' as const,
                text: '',
                rows: [
                  ['ID', 'Requirement', 'Priority', 'Related UR', 'Related DS', 'Related TC'],
                  ['FR-LIVE-009', 'Late', 'P1', '—', '—', 'TC-LIVE-012']
                ]
              }
            ]
          : []),
        {
          kind: 'table',
          text: '',
          rows: [
            ['ID', 'Requirement'],
            ['UR-LIVE-004', 'x'],
            ['NFR-LIVE-003', 'y'],
            ['FR-LIVE-007', 'z']
          ]
        },
        {
          kind: 'table',
          text: '',
          rows: [
            ['ID', 'Title'],
            ['DS-LIVE-010', 'w']
          ]
        }
      ]
    })
  } as unknown as SrsAdapter

  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sf-next-ids-'))
    writeFileSync(join(dir, 'm.json'), JSON.stringify({ tools: { srs: { backend: 'next-ids-stub' } } }))
    registerSrsBackend('next-ids-stub', () => adapter)
  })
  afterEach(() => {
    unregisterSrsBackend('next-ids-stub')
    rmSync(dir, { recursive: true, force: true })
  })

  it('requires --feature', () => {
    expect(() => parseArgs([])).toThrow(SrsUsageError)
  })

  it('gives the next version and the next id per category, after the highest one used', async () => {
    const out: string[] = []
    const code = await runNextIds({ manifestPath: join(dir, 'm.json'), feature: 'https://notion.so/x', json: true }, { stdout: (c) => out.push(c), stderr: () => {} })
    expect(code).toBe(0)
    const result = JSON.parse(out.join(''))
    expect(result.nextVersion).toBe('v3')
    expect(result.next).toEqual({ UR: ['UR-LIVE-005'], FR: ['FR-LIVE-010'], DS: ['DS-LIVE-011'], TC: ['TC-LIVE-013'], NFR: ['NFR-LIVE-004'] })
  })
})
