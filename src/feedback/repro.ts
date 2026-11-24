import { classifyProjectCapabilities } from '../project-capabilities'
import type { SaaSFoundryManifest } from '../types'
import { isSensitiveKey, redactText, REDACTED_VALUE } from './redact'

/**
 * What `sf feedback bug --auto-repro` attaches of `.saasfoundry.json` (#972).
 *
 * The first version pasted the whole file. On a fresh `full` monorepo that is ~81 KB, almost all of it
 * `fileHashes`, above the 65,536 characters GitHub accepts in an issue body, so no bug could be filed from a
 * real project. A reproduction needs the facts that decide which code path ran, not the bookkeeping:
 *
 * - kept: the derived profile and capabilities, the CLI version that wrote the manifest, `structure`,
 *   `projectName`, `mainBranch`, ports, language, every module with its version and choices, the workflow's
 *   tool, preset, branches and status names, the AI rules, and the SRS and tool flags;
 * - counted, not copied: `fileHashes`, `unmanagedPaths`, the SRS scan excludes;
 * - left out: `$schema`, the project board URL, SRS page ids and URLs, account names, hashes and every
 *   file path. They name private workspaces or are bulk, and none of them changes which path ran.
 *
 * The summary is built from an allow-list: a field this file does not know is never copied, only its name is
 * listed under `unlistedKeys`, so a field added to the manifest later cannot reach GitHub by default. Every
 * string goes through {@link redactText} and a length cap, and the block is bounded as a whole.
 */

export type ReproValue = string | number | boolean | null | ReproValue[] | { [key: string]: ReproValue }
export type ManifestSummary = Record<string, ReproValue>

/** The most characters the serialized summary may take; a manifest that exceeds it falls back to the core summary. */
export const REPRO_MANIFEST_BUDGET = 12_000

const MAX_STRING = 200
const MAX_KEY = 100
const MAX_ITEMS = 50
const MAX_KEYS = 50
/** Deep enough for `modules.harness.routing.tiers.<tier>.<agent>.{model,effort}`, the deepest block the schema defines. */
const MAX_DEPTH = 8
/** Redaction runs on at most this many characters of a string: a longer one is cut anyway, and a regex on megabytes is a stall. */
const PRE_REDACTION_CAP = MAX_STRING * 10

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Redact first, cut second: a token cut in half before redaction would no longer match its rule. */
function text(value: unknown, max: number = MAX_STRING): string | undefined {
  if (typeof value !== 'string') return undefined
  const clean = redactText(value.slice(0, PRE_REDACTION_CAP))
  return clean.length > max || value.length > PRE_REDACTION_CAP ? `${clean.slice(0, max)}…` : clean
}

const flag = (value: unknown): boolean | undefined => (typeof value === 'boolean' ? value : undefined)
const count = (value: unknown): number | undefined => (Array.isArray(value) ? value.length : isRecord(value) ? Object.keys(value).length : undefined)
const whole = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)

function strings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const kept = value.slice(0, MAX_ITEMS).flatMap((item) => text(item) ?? [])
  if (value.length > MAX_ITEMS) kept.push(`…(+${value.length - MAX_ITEMS} more)`)
  return kept
}

function names(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const kept = value.slice(0, MAX_ITEMS).flatMap((item) => text(isRecord(item) ? item['name'] : item) ?? [])
  if (value.length > MAX_ITEMS) kept.push(`…(+${value.length - MAX_ITEMS} more)`)
  return kept
}

/** A bounded copy of a value that is safe by shape: used for the `modules` block, whose keys are modules this code cannot list in advance. */
function bounded(value: unknown, depth = 0): ReproValue | undefined {
  if (typeof value === 'string') return text(value)
  if (typeof value === 'boolean' || value === null) return value
  if (typeof value === 'number') return whole(value)
  if (depth >= MAX_DEPTH) return '…(nested too deeply)'
  if (Array.isArray(value)) {
    const items: ReproValue[] = []
    for (const item of value.slice(0, MAX_ITEMS)) {
      const copied = bounded(item, depth + 1)
      if (copied !== undefined) items.push(copied)
    }
    if (value.length > MAX_ITEMS) items.push(`…(+${value.length - MAX_ITEMS} more)`)
    return items
  }
  if (isRecord(value)) {
    const keys = Object.keys(value)
    const entries: [string, ReproValue][] = []
    for (const key of keys.slice(0, MAX_KEYS)) {
      const name = text(key, MAX_KEY)
      if (name === undefined) continue
      const copied = isSensitiveKey(key) ? REDACTED_VALUE : bounded(value[key], depth + 1)
      if (copied !== undefined) entries.push([name, copied])
    }
    if (keys.length > MAX_KEYS) entries.push(['…', `+${keys.length - MAX_KEYS} more keys`])
    return Object.fromEntries(entries)
  }
  return undefined
}

/** Build an object from the entries that hold a value; `Object.fromEntries` defines own properties, so a key named `__proto__` stays data. */
function compact(entries: [string, ReproValue | undefined][]): { [key: string]: ReproValue } {
  return Object.fromEntries(entries.filter((entry): entry is [string, ReproValue] => entry[1] !== undefined))
}

function summarizeAdoption(value: unknown): ReproValue | undefined {
  if (!isRecord(value)) return undefined
  return compact([
    ['kind', text(value['kind'])],
    ['sourceVersion', text(value['sourceVersion'])],
    ['layout', text(value['layout'])],
    ['refreshPending', flag(value['refreshPending'])]
  ])
}

function summarizeProjection(value: unknown): ReproValue | undefined {
  if (!isRecord(value)) return undefined
  return compact([
    ['kind', text(value['kind'])],
    ['app', text(value['app'])]
  ])
}

function summarizePorts(value: unknown): ReproValue | undefined {
  if (!isRecord(value)) return undefined
  return compact(['db', 'api', 'web', 's3', 's3Console', 'mail'].map((key): [string, ReproValue | undefined] => [key, whole(value[key])]))
}

function summarizeLanguage(value: unknown): ReproValue | undefined {
  if (!isRecord(value)) return undefined
  return compact(['srs', 'tickets', 'codeComments'].map((key): [string, ReproValue | undefined] => [key, text(value[key])]))
}

function summarizeWorkflow(value: unknown): ReproValue | undefined {
  if (!isRecord(value)) return undefined
  const naming = isRecord(value['branchNaming']) ? value['branchNaming'] : undefined
  const commit = isRecord(value['commitFormat']) ? value['commitFormat'] : undefined
  const localCi = isRecord(value['localCi']) ? value['localCi'] : undefined
  return compact([
    ['tool', text(value['tool'])],
    ['template', text(value['template'])],
    ['workingBranch', text(value['workingBranch'])],
    ['prTargetBranch', text(value['prTargetBranch'])],
    ['releaseBranch', text(value['releaseBranch'])],
    ['requireCodeReview', flag(value['requireCodeReview'])],
    ['validated', flag(value['validated'])],
    ['hasProjectUrl', typeof value['projectUrl'] === 'string' ? true : undefined],
    [
      'branchNaming',
      naming &&
        compact([
          ['feature', text(naming['feature'])],
          ['fix', text(naming['fix'])],
          ['release', text(naming['release'])]
        ])
    ],
    [
      'commitFormat',
      commit &&
        compact([
          ['pattern', text(commit['pattern'])],
          ['requireTicket', flag(commit['requireTicket'])],
          ['types', strings(commit['types'])]
        ])
    ],
    ['localCi', localCi && compact([['requiredStatuses', strings(localCi['requiredStatuses'])]])],
    ['statuses', names(value['statuses'])],
    ['issueTypes', names(value['issueTypes'])]
  ])
}

function summarizeTools(value: unknown): ReproValue | undefined {
  if (!isRecord(value)) return undefined
  const srs = isRecord(value['srs']) ? value['srs'] : undefined
  const scan = srs && isRecord(srs['scan']) ? srs['scan'] : undefined
  const selection = (entry: unknown): ReproValue | undefined => (isRecord(entry) ? compact([['name', text(entry['name'])]]) : undefined)
  const known = new Set(['srs', 'tracker', 'docs', 'design'])
  const unlisted = Object.keys(value).filter((key) => !known.has(key))
  return compact([
    [
      'srs',
      srs &&
        compact([
          ['enabled', flag(srs['enabled'])],
          ['backend', text(srs['backend'])],
          ['hasRootPage', isRecord(srs['rootPage']) ? true : undefined],
          ['pendingIngestion', isRecord(srs['pendingIngestion']) ? true : undefined],
          ['scanExcludeCount', scan ? count(scan['exclude']) : undefined]
        ])
    ],
    ['tracker', selection(value['tracker'])],
    ['docs', selection(value['docs'])],
    ['design', names(value['design'])],
    ['unlistedKeys', unlisted.length > 0 ? unlisted.slice(0, MAX_KEYS).flatMap((key) => text(key, MAX_KEY) ?? []) : undefined]
  ])
}

/** The top-level keys the summary accounts for, kept or counted or left out on purpose. A key outside it is listed by name only. */
const ACCOUNTED_KEYS = new Set([
  '$schema',
  'manifestVersion',
  'version',
  'generatedAt',
  'structure',
  'projectName',
  'adoption',
  'projection',
  'mainBranch',
  'ports',
  'modules',
  'language',
  'skillsAccounts',
  'fileHashes',
  'unmanagedPaths',
  'workflow',
  'aiRules',
  'tools'
])

/** The profile and capabilities `sf status` would derive from this manifest; `undefined` when the manifest is too malformed to classify. */
function summarizeCapabilities(manifest: Record<string, unknown>): ReproValue | undefined {
  try {
    const capabilities = classifyProjectCapabilities(manifest as unknown as SaaSFoundryManifest)
    return { profile: capabilities.effectiveProfile, technicalStack: capabilities.technicalStack, collaborationHarness: capabilities.collaborationHarness }
  } catch {
    return undefined
  }
}

/**
 * The full summary of a parsed manifest, or `null` when `manifest` is not a JSON object.
 * Never throws and never copies a value it was not written to copy.
 */
export function summarizeManifest(manifest: unknown): ManifestSummary | null {
  if (!isRecord(manifest)) return null
  const unlisted = Object.keys(manifest).filter((key) => !ACCOUNTED_KEYS.has(key))
  const skillAccounts = isRecord(manifest['skillsAccounts']) ? Object.keys(manifest['skillsAccounts']) : undefined
  return compact([
    ['capabilities', summarizeCapabilities(manifest)],
    ['version', text(manifest['version'])],
    ['manifestVersion', whole(manifest['manifestVersion'])],
    ['generatedAt', text(manifest['generatedAt'])],
    ['structure', text(manifest['structure'])],
    ['projectName', text(manifest['projectName'])],
    ['mainBranch', text(manifest['mainBranch'])],
    ['projection', summarizeProjection(manifest['projection'])],
    ['adoption', summarizeAdoption(manifest['adoption'])],
    ['ports', summarizePorts(manifest['ports'])],
    ['language', summarizeLanguage(manifest['language'])],
    ['modules', bounded(manifest['modules'])],
    ['workflow', summarizeWorkflow(manifest['workflow'])],
    ['aiRules', isRecord(manifest['aiRules']) ? bounded(manifest['aiRules']) : undefined],
    ['tools', summarizeTools(manifest['tools'])],
    ['skillsAccounts', skillAccounts && compact([['skills', skillAccounts.slice(0, MAX_KEYS).flatMap((key) => text(key, MAX_KEY) ?? [])]])],
    ['fileHashes', isRecord(manifest['fileHashes']) ? { count: count(manifest['fileHashes']) ?? 0 } : undefined],
    ['unmanagedPaths', Array.isArray(manifest['unmanagedPaths']) ? { count: manifest['unmanagedPaths'].length } : undefined],
    ['unlistedKeys', unlisted.length > 0 ? unlisted.slice(0, MAX_KEYS).flatMap((key) => text(key, MAX_KEY) ?? []) : undefined]
  ])
}

/**
 * The identity of the project and nothing else: what stays when the full summary is itself over budget
 * (a manifest with hundreds of modules or an enormous routing block), and what the body falls back to when
 * the description leaves no room for more. Each value is already redacted and capped, so it is small by construction.
 */
export function coreSummary(summary: ManifestSummary): ManifestSummary {
  const pick = (...keys: string[]): [string, ReproValue | undefined][] => keys.map((key) => [key, summary[key]])
  const modules = summary['modules']
  const workflow = summary['workflow']
  return compact([
    ...pick('capabilities', 'version', 'manifestVersion', 'structure', 'projectName', 'mainBranch', 'language'),
    ['modules', isRecord(modules) ? { keys: Object.keys(modules).slice(0, MAX_KEYS) } : undefined],
    [
      'workflow',
      isRecord(workflow)
        ? compact([
            ['tool', workflow['tool']],
            ['template', workflow['template']]
          ])
        : undefined
    ],
    ...pick('fileHashes', 'unmanagedPaths')
  ])
}

/** What the reader of `.saasfoundry.json` found, kept apart from how it is worded in the body. */
export type ManifestRepro = { status: 'absent' } | { status: 'unreadable' } | { status: 'invalid'; rawLength: number } | { status: 'summarized'; rawLength: number; summary: ManifestSummary }

export function serializeSummary(summary: ManifestSummary): string {
  return JSON.stringify(summary, null, 2)
}

/** A code fence longer than any run of backticks in `content`, so a manifest string cannot close it and write markdown (or an @mention) into the issue. */
function fenceFor(content: string): string {
  const longest = (content.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0)
  return '`'.repeat(Math.max(3, longest + 1))
}

/** Markdown lines for the manifest part of the repro. `core` forces the reduced summary. */
export function renderManifestRepro(repro: ManifestRepro, level: 'full' | 'core' = 'full'): string[] {
  switch (repro.status) {
    case 'absent':
      return ['_(no .saasfoundry.json found in cwd)_']
    case 'unreadable':
      return ['_(.saasfoundry.json found in cwd but could not be read)_']
    case 'invalid':
      return [`_(.saasfoundry.json found in cwd (${repro.rawLength} characters) but it is not a valid JSON object; no excerpt attached)_`]
    case 'summarized': {
      let summary = repro.summary
      let reduced = level === 'core'
      let json = serializeSummary(summary)
      if (!reduced && json.length > REPRO_MANIFEST_BUDGET) reduced = true
      if (reduced) {
        summary = coreSummary(repro.summary)
        json = serializeSummary(summary)
      }
      const fence = fenceFor(json)
      return [
        '<details>',
        `<summary>.saasfoundry.json excerpt${reduced ? ' (core fields only)' : ''}</summary>`,
        '',
        `_Excerpt of the ${repro.rawLength}-character manifest. Counted, not copied: \`fileHashes\`, \`unmanagedPaths\`. Left out: \`$schema\`, URLs, SRS page ids, account names. Credentials and home directories are scrubbed._`,
        '',
        `${fence}json`,
        json,
        fence,
        '</details>'
      ]
    }
  }
}
