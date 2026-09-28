import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { CodebaseScanner, CodebaseScannerContext, EndpointFinding } from './types'

/**
 * Commander command registrations are the `endpoint` surface of a CLI project.
 *
 * `endpoint` is a stack-neutral concept — "any invocable operation (HTTP route, RPC/command,
 * CLI command, queue handler)", per `data/clustering-rules.json`. Before this scanner the three
 * implementation scanners only understood NestJS controllers, Prisma models and React pages, so
 * a CLI or library codebase produced ZERO implementation findings and `sf srs eval` silently
 * scored its FRs against test files and documentation headings instead.
 */

// `.command('new')` — the quoted name may carry an argument spec (`deploy <env>`), which is not
// part of the command's identity.
const COMMAND_RE = /\.command\(\s*['"`]([^'"`]+)['"`]/g
// The `.description('...')` that follows a `.command(...)` in the same chain.
const DESCRIPTION_RE = /\.description\(\s*['"`]([^'"`]+)['"`]/

export interface CliCommand {
  name: string
  description?: string
}

/**
 * Pure extractor: pulls every Commander command out of a source file, pairing each with the
 * `.description()` that follows it in the same chain (the next `.command(` ends the chain).
 */
export function extractCliCommands(content: string): CliCommand[] {
  const out: CliCommand[] = []
  const matches = [...content.matchAll(COMMAND_RE)]
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]
    const name = match[1].trim().split(/\s+/)[0]
    if (!name) continue
    const chainStart = (match.index ?? 0) + match[0].length
    const chainEnd = i + 1 < matches.length ? (matches[i + 1].index ?? content.length) : content.length
    const description = content.slice(chainStart, chainEnd).match(DESCRIPTION_RE)?.[1]
    out.push({ name, description })
  }
  return out
}

/** First key of `bin` in the scan root's package.json — the name users actually type. */
function resolveBinName(scanRoot: string): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(join(scanRoot, 'package.json'), 'utf8'))
    if (typeof pkg.bin === 'string') return typeof pkg.name === 'string' ? pkg.name : undefined
    const keys = pkg.bin && typeof pkg.bin === 'object' ? Object.keys(pkg.bin) : []
    return keys.length > 0 ? keys[0] : undefined
  } catch {
    return undefined
  }
}

function isEntrypointCandidate(relPath: string): boolean {
  return /(^|\/)(index|cli|main|program)\.tsx?$/.test(relPath) || /(^|\/)bin\//.test(relPath)
}

export const cliScanner: CodebaseScanner = {
  id: 'cli',
  describe: 'Commander command registrations → endpoint findings (regex-based)',
  async collect(context: CodebaseScannerContext): Promise<EndpointFinding[]> {
    const binName = resolveBinName(context.scanRoot)
    const specFiles = context.files.filter((f) => /\.(spec|test|e2e)\.tsx?$/.test(f))
    const findings: EndpointFinding[] = []

    for (const relFile of context.files) {
      if (!isEntrypointCandidate(relFile)) continue
      if (/\.(spec|test|e2e)\.tsx?$/.test(relFile)) continue

      let content: string
      try {
        content = readFileSync(join(context.scanRoot, relFile), 'utf8')
      } catch {
        continue
      }
      if (!content.includes('.command(')) continue

      for (const command of extractCliCommands(content)) {
        // A command is covered when a spec names it — either in its filename
        // (`new.non-interactive.spec.ts`) or under a `commands/` folder.
        const hasTests = specFiles.some((spec) => {
          const base = spec.split('/').pop() ?? ''
          return base.startsWith(`${command.name}.`) || (spec.includes('/commands/') && base.includes(command.name))
        })

        findings.push({
          kind: 'endpoint',
          // The CLI command surface is one structural unit, whatever file registers it.
          area: 'commands',
          file: relFile,
          method: 'CLI',
          path: binName ? `${binName} ${command.name}` : command.name,
          hasTests,
          title: binName ? `${binName} ${command.name}` : command.name,
          notes: command.description
        })
      }
    }

    return findings
  }
}
