import { parseArgs as parseApplyArgs, runApplyUpdate } from '../srs/bin/apply-srs-update'
import { parseArgs as parseBrowseArgs, runBrowseTree } from '../srs/bin/browse-tree'
import { parseArgs as parseDraftCodebaseArgs, runDraftFromCodebase } from '../srs/bin/draft-from-codebase'
import { parseArgs as parseDraftNotionPagesArgs, runDraftFromNotionPages } from '../srs/bin/draft-from-notion-pages'
import { parseArgs as parseEvalArgs, runEvalSrs } from '../srs/bin/eval-srs'
import { parseArgs as parseSpawnArgs, runSpawn } from '../srs/bin/spawn'
import { runValidate } from '../srs/bin/validate'
import { parseArgs as parseWriteArgs, runWriteSrs } from '../srs/bin/write-srs'

const USAGE = `Usage: sf srs <action> [args...]

Actions:
  help                                   Print this message
  validate [manifest]                    Smoke-test the configured backend via adapter.init()
  browse --parent <id> [--manifest]      List direct children of a parent page (JSON)
  draft --from notion-pages --ids <id1,id2,...> [--manifest]
                                         Fetch pages from the backend as RawContent (JSON)
  draft --from codebase [--path <dir>] [--manifest]
                                         Scan the local codebase and emit structured findings (JSON)
  write --spec <path> [--manifest] [--no-clear-pending]
                                         Apply a DraftCandidate[] spec file through the adapter
  spawn --ticket <n> --epic <page-url-or-id> [--version <title-url-or-id>] [--dry-run] [--manifest] [--bypass-reason <text>]
                                         Enumerate FR page children of an Epic and create Story sub-tickets
  apply-update [--patch <path>] [--manifest]
                                         Apply a conversational eval-hook patch (ADD-only)
  eval [--path <dir>] [--root-page <id>] [--threshold <pct>] [--json] [--manifest]
                                         Score SRS freshness vs. codebase (batch)

Common options:
  --manifest <path>                      Manifest file to read (default: .saasfoundry.json)

Exit codes (shared contract):
  0 success · 2 bad input · 3 missing backend · 4 unknown backend · 5 runtime ·
  6 write partial (rollbackHint) · 7 write ok but pendingIngestion clear failed

For details, see .claude/skills/sf-srs/SKILL.md.
`

function emitUsage(): void {
  process.stdout.write(USAGE)
}

function runDraft(argv: string[]): Promise<number> {
  let source = 'notion-pages'
  const forwarded: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--from') {
      source = argv[++i] ?? ''
    } else if (arg.startsWith('--from=')) {
      source = arg.slice('--from='.length)
    } else {
      forwarded.push(arg)
    }
  }
  if (!source) {
    process.stderr.write('sf srs draft: --from <source> is required (notion-pages | codebase).\n')
    return Promise.resolve(2)
  }
  if (source === 'notion-pages') {
    const { pageIds, manifestPath } = parseDraftNotionPagesArgs(forwarded)
    return runDraftFromNotionPages({ pageIds, manifestPath })
  }
  if (source === 'codebase') {
    const { scanPath, manifestPath, unknown } = parseDraftCodebaseArgs(forwarded)
    if (unknown) {
      process.stderr.write(`sf srs draft --from codebase: unknown option '${unknown}'\n`)
      return Promise.resolve(2)
    }
    return runDraftFromCodebase({ scanPath, manifestPath })
  }
  process.stderr.write(`sf srs draft: unknown --from value '${source}' (expected: notion-pages | codebase).\n`)
  return Promise.resolve(2)
}

export async function srsCommand(subcommand?: string, ...rest: string[]): Promise<void> {
  const action = subcommand ?? 'help'
  const argv = rest.filter((arg): arg is string => typeof arg === 'string' && arg !== undefined)

  let code = 0
  try {
    switch (action) {
      case 'help':
      case '-h':
      case '--help':
        emitUsage()
        code = 0
        break
      case 'validate': {
        const manifestPath = argv[0] ?? '.saasfoundry.json'
        code = await runValidate({ manifestPath })
        break
      }
      case 'browse': {
        const { parentId, manifestPath } = parseBrowseArgs(argv)
        code = await runBrowseTree({ parentId, manifestPath })
        break
      }
      case 'draft':
        code = await runDraft(argv)
        break
      case 'write': {
        const options = parseWriteArgs(argv)
        code = await runWriteSrs(options)
        break
      }
      case 'spawn': {
        const options = parseSpawnArgs(argv)
        code = await runSpawn(options)
        break
      }
      case 'apply-update': {
        const options = parseApplyArgs(argv)
        code = await runApplyUpdate(options)
        break
      }
      case 'eval': {
        const options = parseEvalArgs(argv)
        code = await runEvalSrs(options)
        break
      }
      default:
        process.stderr.write(`sf srs: unknown action '${action}'\n`)
        emitUsage()
        code = 2
        break
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`sf srs ${action}: unexpected error — ${message}\n`)
    code = 1
  }

  if (code !== 0) process.exitCode = code
}
