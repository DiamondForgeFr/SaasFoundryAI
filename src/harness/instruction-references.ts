import { posix } from 'path'

/**
 * References to a `CLAUDE.md` file inside Markdown instructions (#1152).
 *
 * The harness v3 → v4 migration deletes the `CLAUDE.md` of the project and of each app, and moves the
 * sections it does not own verbatim into `AGENTS.md`. A moved section can still name a file that is now
 * gone (a project-structure tree line, "Check `apps/api/CLAUDE.md`"). The migration rewrites the references
 * that leave no doubt while it moves the text, reports a bare name in running text it cannot be sure of, and
 * `sf status` reports what an already migrated project holds. All three read a reference the same way, here.
 */

/** The heading the migration puts above an edited copy of a generated section. */
export const KEPT_FOR_REVIEW_HEADING = '## Kept from CLAUDE.md for review'
/** The start of the HTML comments the migration writes into AGENTS.md; they name CLAUDE.md as the source, not as a file to read. */
export const MIGRATED_FROM_CLAUDE_MD_MARKER = '<!-- saasfoundry:migrated-from-claude-md'

/**
 * A path ending in `CLAUDE.md`: an optional `~/` or `/` anchor, then directories. Anything glued to the
 * name (`MYCLAUDE.md`, `CLAUDE.mdx`, `CLAUDE.md.saasfoundry.new`) or to the path (a URL, `foo.CLAUDE.md`)
 * is another file.
 */
const CLAUDE_MD_REFERENCE = /(?<![\w@~./-])((?:~\/|\/)?(?:[\w@.-]+\/)*)CLAUDE\.md(?![\w-]|\.\w)/g

/** What precedes the name of an entry in a drawn tree: `│   │   └── `, `├── `, `|-- `, `+-- `. A list marker (`- `) is not one. */
const TREE_ENTRY_PREFIX = /^[\s│┃|]*[├└┣┗+`|\\][─━\-_]+\s*$/

/**
 * How a `CLAUDE.md` is written, which says how sure it is that the file is meant:
 * - `path`: with a directory (`apps/api/CLAUDE.md`, `./CLAUDE.md`), so it names a location;
 * - `tree`: the name of an entry in a drawn project tree, which lists the file;
 * - `name`: a bare name in running text. It can name the file ("Read CLAUDE.md first") or label it
 *   ("fixture CLAUDE.md canary"), and nothing in the text says which.
 */
export type ClaudeMdForm = 'path' | 'tree' | 'name'

export interface ClaudeMdReference {
  /** 1-based line within the text that was searched, offset by `firstLine`. */
  line: number
  /** Index of the reference in the text. */
  index: number
  /** The path as written, `CLAUDE.md` included. */
  text: string
  /** What precedes `CLAUDE.md` in the path (`apps/api/`), empty for a bare name. */
  directory: string
  form: ClaudeMdForm
}

/** Every `CLAUDE.md` path in `content`, fenced blocks and inline code included: a tree drawn in a fence is the usual case. */
export function findClaudeMdReferences(content: string, firstLine = 1): ClaudeMdReference[] {
  const references: ClaudeMdReference[] = []
  let line = firstLine
  let counted = 0
  for (const match of content.matchAll(CLAUDE_MD_REFERENCE)) {
    const index = match.index ?? 0
    for (let i = counted; i < index; i++) if (content[i] === '\n') line++
    counted = index
    const directory = match[1]
    const form = directory ? 'path' : TREE_ENTRY_PREFIX.test(content.slice(content.lastIndexOf('\n', index - 1) + 1, index)) ? 'tree' : 'name'
    references.push({ line, index, text: match[0], directory, form })
  }
  return references
}

/**
 * The project-relative path a reference names when it is written in a file of `dir` (project-relative,
 * '' for the root): a bare name is the `CLAUDE.md` of that directory. Undefined for a path the project
 * does not hold: under the home directory, absolute, or above the root.
 */
export function resolveClaudeMdReference(dir: string, reference: Pick<ClaudeMdReference, 'directory'>): string | undefined {
  if (reference.directory.startsWith('~') || reference.directory.startsWith('/')) return undefined
  const resolved = posix.normalize(posix.join(dir, reference.directory, 'CLAUDE.md'))
  return resolved.startsWith('..') ? undefined : resolved
}

/** The two kinds of line the migration writes that name CLAUDE.md as the origin of what follows. */
export function isMigrationMarker(line: string): boolean {
  const trimmed = line.trim()
  return trimmed === KEPT_FOR_REVIEW_HEADING || trimmed.startsWith(MIGRATED_FROM_CLAUDE_MD_MARKER)
}

export interface ReferenceRewrite {
  /** Line of the reference in the CLAUDE.md the section comes from. */
  line: number
  from: string
  to: string
}

export interface RewrittenReferences {
  text: string
  rewrites: ReferenceRewrite[]
  /** Bare names in running text that name a removed file, left as written: they can be a label (see `ClaudeMdForm`). */
  mentions: number[]
}

/**
 * Point every reference to a file in `removed` (project-relative `CLAUDE.md` paths the migration deletes)
 * at the `AGENTS.md` beside it, when the text leaves no doubt that it names the file: a path with a
 * directory, or an entry of a drawn tree. A bare name in running text is left as written and its line
 * is returned in `mentions`. A reference to any other file (`~/.claude/CLAUDE.md`, a `CLAUDE.md` that
 * stays) and every other word is left as written too.
 *
 * `dir` is where the text is written, `firstLine` the line of its first character in CLAUDE.md.
 */
export function rewriteRemovedClaudeMdReferences(text: string, dir: string, removed: ReadonlySet<string>, firstLine = 1): RewrittenReferences {
  const rewrites: ReferenceRewrite[] = []
  const mentions: number[] = []
  let rewritten = ''
  let cursor = 0
  for (const reference of findClaudeMdReferences(text, firstLine)) {
    const target = resolveClaudeMdReference(dir, reference)
    if (target === undefined || !removed.has(target)) continue
    if (reference.form === 'name') {
      mentions.push(reference.line)
      continue
    }
    const to = `${reference.directory}AGENTS.md`
    rewritten += text.slice(cursor, reference.index) + to
    cursor = reference.index + reference.text.length
    rewrites.push({ line: reference.line, from: reference.text, to })
  }
  return { text: rewritten + text.slice(cursor), rewrites, mentions }
}
