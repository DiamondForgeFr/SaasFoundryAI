import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resolveScannerRoots } from '../../../../srs/scanners/paths'

describe('resolveScannerRoots', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'sf-srs-paths-'))
  })

  it('maps monorepo to api/ and web/ subfolders', () => {
    const roots = resolveScannerRoots(tmp, 'monorepo')

    expect(roots.apiRoot).toBe(join(tmp, 'api'))
    expect(roots.webRoot).toBe(join(tmp, 'web'))
  })

  it('maps monorepo even when the subfolders do not exist yet', () => {
    const roots = resolveScannerRoots(tmp, 'monorepo')

    expect(roots.apiRoot.endsWith('/api')).toBe(true)
    expect(roots.webRoot.endsWith('/web')).toBe(true)
  })

  it('prefers api/ and web/ subfolders for multirepo when present', () => {
    mkdirSync(join(tmp, 'api'))
    mkdirSync(join(tmp, 'web'))

    const roots = resolveScannerRoots(tmp, 'multirepo')

    expect(roots.apiRoot).toBe(join(tmp, 'api'))
    expect(roots.webRoot).toBe(join(tmp, 'web'))
  })

  it('falls back to scanRoot for multirepo when api/ and web/ are absent', () => {
    const roots = resolveScannerRoots(tmp, 'multirepo')

    expect(roots.apiRoot).toBe(tmp)
    expect(roots.webRoot).toBe(tmp)
  })

  it('treats src/modules as api signal but returns scanRoot itself for multirepo api layout', () => {
    mkdirSync(join(tmp, 'src'))
    mkdirSync(join(tmp, 'src', 'modules'))

    const roots = resolveScannerRoots(tmp, 'multirepo')

    expect(roots.apiRoot).toBe(tmp)
  })

  it('treats src/pages as web signal but returns scanRoot itself for multirepo web layout', () => {
    mkdirSync(join(tmp, 'src'))
    mkdirSync(join(tmp, 'src', 'pages'))

    const roots = resolveScannerRoots(tmp, 'multirepo')

    expect(roots.webRoot).toBe(tmp)
  })

  it('handles undefined structure like multirepo', () => {
    const roots = resolveScannerRoots(tmp, undefined)

    expect(roots.apiRoot).toBe(tmp)
    expect(roots.webRoot).toBe(tmp)
  })
})
