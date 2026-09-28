import chalk from 'chalk'
import { createReadStream, existsSync, statSync } from 'fs'
import { createServer } from 'http'
import { extname, join, normalize, resolve } from 'path'
import { execSync } from 'child_process'

import { isPortFree } from '../ports'
import { version as cliVersion } from '../../package.json'

/**
 * `sf docs` — the documentation, offline.
 *
 * Every `npx saasfoundryai-cli` line in the docs used to point at
 * `https://docs.saasfoundry.io (coming soon)`, a site that has never been deployed. Someone
 * who installed the CLI got no documentation at all: `package.json` shipped `dist`, `bin`
 * and `scaffolds`, and the built site was not among them (#626).
 *
 * It travels in the package now. The online site comes later; this is what makes the
 * documentation exist in the meantime, and it keeps working on a plane.
 */

const DEFAULT_PORT = 5177

/** Enough of the web to serve a VitePress build. Anything else is bytes. */
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
}

/**
 * Where the built site sits, whether this is an installed package or the repo it came from.
 *
 * `dist/commands/docs.js` -> two levels up is the package root in both cases, because the
 * repo mirrors the published layout.
 */
export function resolveDocsRoot(): string | undefined {
  const candidates = [resolve(__dirname, '../../docs-dist'), resolve(__dirname, '../../../docs-dist')]
  return candidates.find((c) => existsSync(join(c, 'index.html')))
}

/** First free port at or after `start`, so two `sf docs` can run side by side. */
async function freePort(start: number, limit = 20): Promise<number> {
  for (let port = start; port < start + limit; port++) {
    if (await isPortFree(port)) return port
  }
  throw new Error(`Could not find a free port between ${start} and ${start + limit - 1}.`)
}

export interface DocsCommandOptions {
  port?: string
  open?: boolean
}

/** What a caller needs to reach the server, and to stop it. Tests need both. */
export interface DocsServer {
  url: string
  port: number
  close: () => Promise<void>
}

export async function docsCommand(opts: DocsCommandOptions = {}): Promise<DocsServer | undefined> {
  const root = resolveDocsRoot()

  if (!root) {
    // Saying which version is missing its docs beats "not found": it tells the reader
    // whether they are looking at a broken install or a build they never ran.
    console.error(chalk.red(`No documentation found in this installation of saasfoundryai-cli@${cliVersion}.`))
    console.error(chalk.gray('If you are running from a clone, build it once:  npm run docs:build'))
    process.exitCode = 1
    return undefined
  }

  const port = opts.port ? Number(opts.port) : await freePort(DEFAULT_PORT)

  const server = createServer((req, res) => {
    // Everything is resolved under `root` and checked afterwards: a request for
    // `../../.ssh/id_rsa` must not escape the directory being served.
    const requested = decodeURIComponent((req.url ?? '/').split('?')[0])
    let filePath = normalize(join(root, requested))

    if (!filePath.startsWith(root)) {
      res.writeHead(403).end('Forbidden')
      return
    }

    if (existsSync(filePath) && statSync(filePath).isDirectory()) filePath = join(filePath, 'index.html')
    // VitePress emits a real .html per route, so a miss is a genuine 404 rather than an
    // SPA fallback — telling the reader the page does not exist beats silently showing home.
    if (!existsSync(filePath)) {
      const asHtml = `${filePath}.html`
      if (existsSync(asHtml)) filePath = asHtml
      else {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found')
        return
      }
    }

    res.writeHead(200, { 'content-type': MIME[extname(filePath)] ?? 'application/octet-stream' })
    createReadStream(filePath).pipe(res)
  })

  await new Promise<void>((ok, ko) => {
    server.once('error', ko)
    server.listen(port, '127.0.0.1', ok)
  })

  const url = `http://localhost:${port}`
  console.log()
  console.log(chalk.cyan(`  📚 SaaSFoundryAI documentation  ${chalk.gray(`v${cliVersion}`)}`))
  console.log(chalk.gray('     served from this installation — no network needed'))
  console.log()
  console.log(`     ${chalk.blue(url)}`)
  console.log()
  console.log(chalk.gray('     Ctrl+C to stop'))
  console.log()

  if (opts.open !== false) {
    try {
      const openCommand = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open'
      execSync(`${openCommand} ${url}`, { stdio: 'ignore' })
    } catch {
      // A browser that will not open is not a reason to stop serving: the URL is printed
      // right above, and the reader can click it.
    }
  }

  return { url, port, close: () => new Promise<void>((ok) => server.close(() => ok())) }
}
