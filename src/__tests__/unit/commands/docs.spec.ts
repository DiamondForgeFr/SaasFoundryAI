import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { DocsServer, docsCommand, resolveDocsRoot } from '../../../commands/docs'

/**
 * #626 — `saasfoundryai-cli` shipped `dist`, `bin` and `scaffolds`. The built documentation
 * was not among them, so anyone who installed the CLI had no documentation at all — only a
 * link to `https://docs.saasfoundry.io (coming soon)`, a site that has never been deployed.
 *
 * The site is served over http rather than opened as a `file://` URL, which is not a detail:
 * VitePress routing and its asset paths both assume an origin.
 */

const root = resolveDocsRoot()
const built = root !== undefined

// The suite needs a real build. Skipping loudly beats passing on nothing — a green run
// against no documentation would say the opposite of the truth.
const withDocs = built ? describe : describe.skip

describe('sf docs finds the documentation that shipped with it', () => {
  it('locates a built site next to the compiled CLI', () => {
    if (!built) {
      console.warn('docs.spec: no docs-dist build present — run `npm run docs:build`. Server cases skipped.')
      return
    }
    expect(existsSync(join(root!, 'index.html'))).toBe(true)
  })
})

withDocs('sf docs serves it locally', () => {
  let server: DocsServer

  beforeAll(async () => {
    server = (await docsCommand({ open: false, port: '5198' }))!
  })

  afterAll(async () => {
    await server?.close()
  })

  const get = async (path: string): Promise<Response> => fetch(`${server.url}${path}`)

  it('answers the root with the documentation home', async () => {
    const res = await get('/')
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('<title>')
  })

  it('serves a command page', async () => {
    expect((await get('/cli/sf-docs.html')).status).toBe(200)
  })

  it('resolves a directory-style URL to its page', async () => {
    // VitePress emits a real .html per route; the server accepts either shape.
    expect((await get('/cli/sf-docs')).status).toBe(200)
  })

  it('says 404 for a page that does not exist, rather than quietly showing home', async () => {
    expect((await get('/does-not-exist')).status).toBe(404)
  })

  it('refuses to escape the directory it serves', async () => {
    // Encoded, so the request survives client-side normalisation and actually reaches the
    // path check. `..%2f..%2fpackage.json` is the shape that would otherwise read the repo.
    const res = await get('/..%2f..%2fpackage.json')
    expect([403, 404]).toContain(res.status)
    expect(await res.text()).not.toContain('"name"')
  })

  it('serves assets with a content type a browser will act on', async () => {
    const home = await (await get('/')).text()
    const css = home.match(/href="(\/assets\/[^"]+\.css)"/)?.[1]
    expect(css).toBeDefined()
    const res = await get(css!)
    expect(res.headers.get('content-type')).toContain('text/css')
  })
})
