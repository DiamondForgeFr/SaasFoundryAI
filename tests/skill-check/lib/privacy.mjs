import { realpathSync } from 'node:fs'
import { isAbsolute, normalize, resolve, sep } from 'node:path'

/**
 * What keeps a replay from reaching what is not its own, and what keeps its results from carrying the machine they ran on (#1360).
 *
 * - **Deny rules.** Claude Code gets a `Read(<path>)` deny rule for each credential path of `replay.json`, whatever `--agent-home`
 *   says. Claude Code applies a `Read` deny rule to Read, and to the directory Glob and Grep search; a `Glob(<path>)` or
 *   `Grep(<path>)` rule is accepted but never matched, so none is written (https://code.claude.com/docs/en/permissions, "Read and
 *   Edit"). With a scratch HOME, `~` is that scratch folder, so the real HOME's credential paths are also denied by their absolute
 *   spelling (`//Users/<name>/.ssh/**`).
 * - **Redaction.** A results file never holds an absolute path of the machine: the fixture becomes `<fixture>`, the run's scratch
 *   folder `<scratch>`, this checkout `<repo>`, the HOME `~`, and a temporary folder or a user folder nothing else names `<tmp>` or `~`.
 * - **Reads outside the fixture.** Every path an agent read or searched is checked against its fixture folder; the run flags the
 *   ones outside it and exits 1.
 */

/** The deny rules of a Claude Code run: the tools it never gets, then one `Read` rule per credential path. */
export function claudeDenyRules(config, { realHome } = {}) {
  const rules = [...config.claude.denyTools]
  const home = realHome ? realHome.replace(/\/+$/, '') : undefined
  for (const path of config.deniedReadPaths ?? []) {
    rules.push(`Read(${path})`)
    // `//` anchors a rule at the filesystem root; a single `/` would anchor it at the working directory.
    if (home && path.startsWith('~/')) rules.push(`Read(/${home}/${path.slice(2)})`)
  }
  return rules
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A folder and the folder it resolves to: macOS reaches its temporary folders through `/var`, a symlink of `/private/var`. */
function spellings(path) {
  const plain = resolve(path)
  const out = [plain]
  try {
    const real = realpathSync(plain)
    if (real !== plain) out.push(real)
  } catch {
    // gone already, or never there: the plain spelling is all there is
  }
  return out
}

/** The folders a run knows, each with its placeholder: `{ fixture, fixtures, scratch, repo, home }`, any of them left out. */
export function pathRoots({ fixture, fixtures, scratch, repo, home } = {}) {
  const roots = []
  for (const [path, placeholder] of [
    [fixture, '<fixture>'],
    [fixtures, '<fixtures>'],
    [scratch, '<scratch>'],
    [repo, '<repo>'],
    [home, '~']
  ]) {
    if (!path || resolve(path) === sep) continue
    for (const spelling of spellings(path)) roots.push([spelling, placeholder])
  }
  return roots
}

// The end of a path segment: what may not follow a root for the root to be the whole segment.
const SEGMENT_END = String.raw`(?![\w.-])`
const SEGMENT_START = String.raw`(?<![\w.~-])`
const NAME = String.raw`[^/\s"'\x60)\]]+`
const MAC_TMP = String.raw`(?:/private)?/var/folders/${NAME}/${NAME}(?:/[A-Z])?`
const RUN_SCRATCH = String.raw`(?:${MAC_TMP}|(?:/private)?/tmp)/skill-check-[A-Za-z0-9]{6}`

/** `text` with every absolute path of the machine replaced: the known folders first, longest first, then the patterns. */
export function makeRedactor({ roots = [], fixtureId } = {}) {
  const known = [...roots].sort((a, b) => b[0].length - a[0].length).map(([path, placeholder]) => [new RegExp(`${SEGMENT_START}${escapeRegExp(path)}${SEGMENT_END}`, 'g'), placeholder])
  const patterns = []
  if (fixtureId) patterns.push([new RegExp(`${SEGMENT_START}${RUN_SCRATCH}/fixtures/${escapeRegExp(fixtureId)}${SEGMENT_END}`, 'g'), '<fixture>'])
  patterns.push(
    [new RegExp(`${SEGMENT_START}${RUN_SCRATCH}${SEGMENT_END}`, 'g'), '<scratch>'],
    [new RegExp(`${SEGMENT_START}${MAC_TMP}${SEGMENT_END}`, 'g'), '<tmp>'],
    [new RegExp(`${SEGMENT_START}/(?:Users|home)/${NAME}`, 'g'), '~']
  )
  const rules = [...known, ...patterns]
  return (text) => rules.reduce((out, [pattern, placeholder]) => out.replace(pattern, placeholder), text)
}

/** Every string of a JSON value through `redact`; keys and their order are kept, so a file written again differs only where a path was. */
export function redactDeep(value, redact) {
  if (typeof value === 'string') return redact(value)
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, redact))
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactDeep(item, redact)]))
  return value
}

/** A results file with no absolute path of the machine: each scenario is redacted with its own fixture as `<fixture>`. */
export function redactResults(doc, { roots = [], fixtureDirs = {} } = {}) {
  const common = makeRedactor({ roots })
  const out = {}
  for (const [key, value] of Object.entries(doc)) {
    if (key !== 'scenarios' || !Array.isArray(value)) {
      out[key] = redactDeep(value, common)
      continue
    }
    out[key] = value.map((scenario) => {
      const dir = fixtureDirs[scenario.fixture]
      const own = dir ? pathRoots({ fixture: dir }) : []
      return redactDeep(scenario, makeRedactor({ roots: [...own, ...roots], fixtureId: scenario.fixture }))
    })
  }
  return out
}

/** Absolute paths of a machine that a committed file must not hold: a user folder, or a macOS temporary folder. */
export const MACHINE_PATH = /(?<![\w.~-])(?:\/(?:Users|home)\/[^/\s"'`)\]]+|(?:\/private)?\/var\/folders\/)/

/**
 * The paths among `paths` that lie outside `cwd`: an absolute path under neither spelling of it, a path from `~`, a relative path that
 * climbs out with `..`. A path inside is relative already (the runners make it so), or absolute under the folder.
 */
export function findOutsideReads(paths, cwd) {
  const roots = cwd ? spellings(cwd) : []
  return [...new Set(paths.filter((path) => typeof path === 'string' && path.length > 0))].filter((path) => {
    if (path === '~' || path.startsWith('~/')) return true
    if (!isAbsolute(path)) return normalize(path).split(/[\\/]/)[0] === '..'
    const plain = normalize(path)
    return !roots.some((root) => plain === root || plain.startsWith(root + sep))
  })
}
