import { readFile, stat } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'

import { getAgentProfile } from './agent-registry'
import { listTierAssignments, type RoutingOverrides } from './routing-grid'
import { modelAlias } from './tier-agents'

/**
 * The model aliases a Kimi Code session passes on its `Agent` calls (FR-MAH-022).
 *
 * Kimi Code binds no model in an agent file: a call names a key of the user's `[secondary_model.models]` pool, and each
 * key points at a `[models.<alias>]` entry. The harness never writes that configuration, which belongs to the developer
 * (credentials live beside it). This module only **reads** the key names of the pool, to tell the developer which aliases
 * a route needs and are not declared yet, and prints the TOML to paste. A value it does not need (an `api_key`, a base
 * URL) is never read into the result, and the file is never opened for writing.
 */

/** The fields of an existing `[models.<name>]` entry a snippet may copy: what the entry says about the model, never a credential. */
export interface ModelEntry {
  provider?: string
  model?: string
  maxContextSize?: number
  capabilities?: string[]
}

export interface AliasPool {
  /** `present`: the config has a `[secondary_model.models]` pool. `missing`: it has none (or there is no config). `unknown`: the config could not be read. */
  state: 'present' | 'missing' | 'unknown'
  /** The file the pool was read from, as the developer would name it. */
  source: string
  /** Why the config could not be read (state `unknown`). */
  reason?: string
  /** The keys of `[secondary_model.models]`. */
  keys: string[]
  /** The config already has a `[secondary_model]` table, so a snippet must not open it a second time. */
  hasSecondaryModel: boolean
  /** `[secondary_model].default_effort` is set: it outranks the effort every alias carries. */
  defaultEffort: boolean
  /** The `[models.<name>]` entries the config declares, by name. */
  models: Record<string, ModelEntry>
}

/** What a route says about its alias: declared in the pool, not declared, or not known because the pool could not be read. */
export type AliasStatus = 'present' | 'missing' | 'unknown'

export interface AliasSpec {
  alias: string
  model: string
  effort: string
  /** The tiers whose candidate this alias runs. */
  tiers: string[]
}

const MAX_CONFIG_BYTES = 1024 * 1024

/** The config file of Kimi Code: `$KIMI_CODE_HOME/config.toml`, else `~/.kimi-code/config.toml`. */
export function kimiConfigPath(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): { path: string; label: string } {
  const configured = env.KIMI_CODE_HOME?.trim()
  if (configured) return { path: join(configured, 'config.toml'), label: join(configured, 'config.toml') }
  return { path: join(home, '.kimi-code', 'config.toml'), label: '~/.kimi-code/config.toml' }
}

const BARE = '[A-Za-z0-9_-]+'
const BASIC = '"(?:[^"\\\\]|\\\\.)*"'
const LITERAL = "'[^']*'"
const SEGMENT = `(?:${BARE}|${BASIC}|${LITERAL})`
const KEY = `${SEGMENT}(?:\\s*\\.\\s*${SEGMENT})*`
const HEADER = /^\s*\[\s*([^[\]].*?)\s*\]\s*(?:#.*)?$/
const PAIR = new RegExp(`^\\s*(${KEY})\\s*=\\s*(.*)$`)

const unquote = (segment: string): string => {
  if (segment.startsWith('"')) {
    try {
      return JSON.parse(segment) as string
    } catch {
      return segment.slice(1, -1)
    }
  }
  return segment.startsWith("'") ? segment.slice(1, -1) : segment
}

/** The segments of a TOML dotted key (`a.b."c.d"`); undefined when the text is not one. */
function splitKey(text: string): string[] | undefined {
  const segments = text.match(new RegExp(SEGMENT, 'g'))
  if (!segments) return undefined
  // Every character must belong to a segment or to a dot between two of them.
  return segments.join('.').replace(/\s+/g, '') === text.replace(/\s+/g, '') ? segments.map(unquote) : undefined
}

/** The depth change of one line of a multi-line array: brackets count outside strings and comments. */
function bracketDelta(line: string): number {
  let depth = 0
  let quote: string | undefined
  for (let index = 0; index < line.length; index++) {
    const char = line[index]
    if (quote) {
      if (char === '\\' && quote === '"') index++
      else if (char === quote) quote = undefined
    } else if (char === '"' || char === "'") quote = char
    else if (char === '#') break
    else if (char === '[') depth++
    else if (char === ']') depth--
  }
  return depth
}

const stringValue = (text: string): string | undefined => {
  const match = /^\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/.exec(text)
  if (!match) return undefined
  if (match[2] !== undefined) return match[2]
  try {
    return JSON.parse(`"${match[1]}"`) as string
  } catch {
    return match[1]
  }
}

const integerValue = (text: string): number | undefined => {
  const match = /^\s*(\d[\d_]*)\s*(?:#.*)?$/.exec(text)
  return match ? Number(match[1].replaceAll('_', '')) : undefined
}

const stringArray = (text: string): string[] | undefined => {
  if (!/^\s*\[/.test(text)) return undefined
  const items = [...text.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)].map((match) => (match[2] !== undefined ? match[2] : unquote(`"${match[1]}"`)))
  return items
}

/**
 * Read what the alias pool needs from a Kimi Code `config.toml`: the keys of `[secondary_model.models]`, the entries of
 * `[models.*]` (only the fields in `ModelEntry`) and whether `[secondary_model].default_effort` is set. It is a scanner for
 * those tables and keys, not a TOML parser, and it returns `unknown` for what it cannot place instead of guessing.
 */
export function scanAliasPool(text: string, source: string): AliasPool {
  // A config key is the developer's text: no prototype, so `__proto__` or `constructor` is a name like any other.
  const pool: AliasPool = { state: 'missing', source, keys: [], hasSecondaryModel: false, defaultEffort: false, models: Object.create(null) as Record<string, ModelEntry> }
  const entry = (name: string): ModelEntry => (pool.models[name] ??= {})
  let poolTable = false
  let table: string[] = []
  let inlinePool = false
  const lines = text.split(/\r?\n/)
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    if (/^\s*(?:#.*)?$/.test(line)) continue
    const header = HEADER.exec(line)
    if (header && !/^\s*\[\[/.test(line)) {
      table = splitKey(header[1]) ?? []
      if (table[0] === 'secondary_model') pool.hasSecondaryModel = true
      if (table[0] === 'secondary_model' && table[1] === 'models') poolTable = true
      if (table[0] === 'models' && table[1] !== undefined) entry(table[1])
      continue
    }
    if (/^\s*\[\[/.test(line)) {
      table = []
      continue
    }
    const pair = PAIR.exec(line)
    if (!pair) continue
    const path = [...table, ...(splitKey(pair[1]) ?? [])]
    let value = pair[2]
    // A value that spans lines: a multi-line string is skipped, a multi-line array is gathered.
    const delimiter = /^\s*("""|''')/.exec(value)?.[1]
    if (delimiter) {
      if (!value.slice(value.indexOf(delimiter) + 3).includes(delimiter)) {
        while (index + 1 < lines.length && !lines[index + 1].includes(delimiter)) index++
        index++
      }
      value = ''
    } else if (/^\s*\[/.test(value)) {
      let depth = bracketDelta(value)
      while (depth > 0 && index + 1 < lines.length) {
        index++
        value += `\n${lines[index]}`
        depth += bracketDelta(lines[index])
      }
    }
    if (path[0] === 'secondary_model') {
      pool.hasSecondaryModel = true
      if (path[1] === 'default_effort') pool.defaultEffort = true
      if (path[1] === 'models' && path.length === 2 && /^\s*\{/.test(value)) inlinePool = true
      if (path[1] === 'models' && path.length >= 3) {
        poolTable = true
        if (!pool.keys.includes(path[2])) pool.keys.push(path[2])
      }
    }
    if (path[0] === 'models' && path.length >= 3) {
      const fields = entry(path[1])
      if (path.length === 3) {
        if (path[2] === 'provider') fields.provider = stringValue(value)
        if (path[2] === 'model') fields.model = stringValue(value)
        if (path[2] === 'max_context_size') fields.maxContextSize = integerValue(value)
        if (path[2] === 'capabilities') fields.capabilities = stringArray(value)
      }
    }
  }
  if (inlinePool) return { ...pool, state: 'unknown', reason: 'its [secondary_model] pool is an inline table', keys: [] }
  return { ...pool, state: poolTable ? 'present' : 'missing' }
}

/**
 * Read the alias pool of the developer's Kimi Code configuration. Read-only and never throwing: a file that does not
 * exist is a pool with no alias, and one that cannot be read or is not UTF-8 text is `unknown`.
 */
export async function readAliasPool(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): Promise<AliasPool> {
  const { path, label } = kimiConfigPath(env, home)
  const unknown = (reason: string): AliasPool => ({ state: 'unknown', source: label, reason, keys: [], hasSecondaryModel: false, defaultEffort: false, models: {} })
  try {
    const info = await stat(path)
    if (!info.isFile()) return unknown('it is not a regular file')
    if (info.size > MAX_CONFIG_BYTES) return unknown('it is larger than 1 MiB')
    const bytes = await readFile(path)
    let text: string
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      return unknown('it is not UTF-8 text')
    }
    return scanAliasPool(text, label)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'missing', source: label, keys: [], hasSecondaryModel: false, defaultEffort: false, models: {} }
    return unknown(`it cannot be read (${(error as NodeJS.ErrnoException).code ?? 'error'})`)
  }
}

/** Where one alias stands in a pool. */
export const aliasStatus = (pool: AliasPool, alias: string): AliasStatus => (pool.state === 'unknown' ? 'unknown' : pool.keys.includes(alias) ? 'present' : 'missing')

/**
 * The aliases the tier agents of Kimi Code need, one per candidate, from the routing the project declares. Two tiers
 * that share a candidate share an alias. Two different candidates cannot: the alias is a bare key of one pool.
 */
export function aliasSpecs(overrides?: RoutingOverrides): AliasSpec[] {
  const specs = new Map<string, AliasSpec>()
  for (const assignment of listTierAssignments('kimi', overrides)) {
    const alias = modelAlias(assignment.candidate)
    const known = specs.get(alias)
    if (known && (known.model !== assignment.candidate.model || known.effort !== assignment.candidate.effort)) {
      throw new Error(
        `The Kimi Code candidates ${known.model} at ${known.effort} and ${assignment.candidate.model} at ${assignment.candidate.effort} both give the alias ${alias}: change one of them in modules.harness.routing.`
      )
    }
    if (known) known.tiers.push(assignment.tier)
    else specs.set(alias, { alias, model: assignment.candidate.model, effort: assignment.candidate.effort, tiers: [assignment.tier] })
  }
  return [...specs.values()]
}

const tierList = (tiers: string[]): string => (tiers.length === 1 ? `${tiers[0]} tier` : `${tiers.slice(0, -1).join(', ')} and ${tiers[tiers.length - 1]} tiers`)
const describeAlias = (spec: AliasSpec): string => `SaaSFoundry ${tierList(spec.tiers)}: ${spec.model} at ${spec.effort} effort.`

/** An existing entry of the same model: the one whose provider and context size a new alias copies. */
const sameModel = (pool: AliasPool, spec: AliasSpec): ModelEntry | undefined => Object.values(pool.models).find((entry) => entry.model === spec.model)

function modelTable(pool: AliasPool, spec: AliasSpec, efforts: readonly string[]): string[] {
  const known = sameModel(pool, spec)
  const lines = [
    `[models.${spec.alias}]`,
    `provider = ${known?.provider !== undefined ? JSON.stringify(known.provider) : `"<provider of your ${spec.model} entry>"`}`,
    `model = ${JSON.stringify(spec.model)}`,
    `max_context_size = ${known?.maxContextSize ?? `<max_context_size of your ${spec.model} entry>`}`
  ]
  if (known?.capabilities) lines.push(`capabilities = [${known.capabilities.map((capability) => JSON.stringify(capability)).join(', ')}]`)
  else lines.push(`# capabilities = [...]  # copy the capabilities of your ${spec.model} entry, if it has any`)
  lines.push(`support_efforts = [${efforts.map((effort) => JSON.stringify(effort)).join(', ')}]`, '', `[models.${spec.alias}.overrides]`, `default_effort = ${JSON.stringify(spec.effort)}`)
  return lines
}

export interface AliasAdvice {
  /** The aliases to declare: those a pool that could be read lacks, or every one when it could not be read. */
  needed: AliasSpec[]
  /** The TOML to paste, undefined when every alias is declared. */
  snippet?: string
  /** What the developer should know besides the snippet. */
  warnings: string[]
}

/**
 * What the developer must do about the aliases of a route or of a refresh: the entries to paste, and the warnings. The
 * snippet gives the `[models.<alias>]` tables first (a pool key that resolves to no entry makes Kimi Code fail at start),
 * then the lines to add under the existing `[secondary_model.models]` table, never a second header for it.
 */
export function aliasAdvice(pool: AliasPool, specs: readonly AliasSpec[]): AliasAdvice {
  const efforts = getAgentProfile('kimi').capabilities.routing!.efforts
  const warnings: string[] = []
  if (pool.state === 'unknown') warnings.push(`${pool.source} could not be read (${pool.reason}), so sf cannot tell which model aliases it declares.`)
  if (pool.defaultEffort) {
    warnings.push(
      `${pool.source}: [secondary_model].default_effort is set, and it outranks the effort of every alias: each sub-agent runs at that effort, whatever its route says. Remove it to let an alias choose its own.`
    )
  }
  const needed = specs.filter((spec) => aliasStatus(pool, spec.alias) !== 'present')
  if (needed.length === 0) return { needed, warnings }
  const tables = needed.filter((spec) => pool.models[spec.alias] === undefined).flatMap((spec) => [...modelTable(pool, spec, efforts), ''])
  const entries = needed.map((spec) => `${spec.alias} = ${JSON.stringify(describeAlias(spec))}`)
  const lines = [`# Kimi Code: add the following to ${pool.source}.`]
  if (tables.length) lines.push('# 1. The model entries of the aliases, one table each.', '', ...tables)
  if (pool.state === 'present') {
    lines.push(`# ${tables.length ? '2. ' : ''}Add these lines under your existing [secondary_model.models] table; do not repeat its header.`, ...entries)
  } else {
    const how =
      pool.state === 'unknown'
        ? 'If your config already has a [secondary_model.models] table, add the lines under it and leave out the [secondary_model] and [secondary_model.models] lines below.'
        : 'Your config has no [secondary_model.models] table yet.'
    lines.push(
      `# ${tables.length ? '2. ' : ''}The alias pool. ${how} default_model must be a key of the pool: list its key here too if you keep one.`,
      ...(pool.hasSecondaryModel ? [] : ['[secondary_model]', 'default_model = "<the key of the model sub-agents use when no alias is passed>"', '']),
      '[secondary_model.models]',
      ...entries
    )
  }
  return { needed, snippet: lines.join('\n') + '\n', warnings }
}
