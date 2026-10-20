import { stripOwnIdPrefix } from '../builders/srs/fr-title-format'
import { featureFrUpdates, VERSION_HEADINGS, versionAmendmentAdditions, versionAmendmentLine, versionFrUpdates } from '../builders/srs/templates/pages/epic.tpl'
import { FrPageHeadings, frPageUpdates, readFrDetail } from '../builders/srs/templates/pages/fr.tpl'
import { COMPLEXITIES, FrItem, isComplexity, Priority, RawContent, SectionUpdate, SectionUpdateOptions, SectionUpdateOutcome, SrsAdapter } from '../builders/srs/types'
import { parseEpicPage } from './spawn/page-content'
import { ExistingSrsTicket, findTicketsForFr, ReconciliationRequirement } from './spawn/reconciliation'
import { parseFrPageTitle } from './tree/fr-title'
import { SrsTreeFr } from './tree/walk'
import { locateFr, locatePage, readSrsTree } from './version-extension'

// `update-fr` (#945): an existing FR changed where it is listed. The FR is found by its id, the
// patch is turned into the cells that differ on the FR page, the version page and the feature
// page, and nothing is appended: the result of a second run is the same SRS and no write.

/** The follow-ups the plan left out of this ticket, named in the messages that refuse or report them. */
const REFERENCES_FOLLOW_UP = '#1056'
const STORY_FOLLOW_UP = '#1057'

export const FR_CHANGE_FIELDS = ['title', 'description', 'priority', 'complexity', 'endpoint', 'requestBody', 'securityRationale', 'acceptanceCriteria', 'validationRules'] as const
export type FrChangeField = (typeof FR_CHANGE_FIELDS)[number]

const TEXT_FIELDS = ['description', 'endpoint', 'requestBody', 'securityRationale'] as const
const LIST_FIELDS = ['acceptanceCriteria', 'validationRules'] as const
type ListField = (typeof LIST_FIELDS)[number]
const REFERENCE_FIELDS = ['urRefs', 'dsRefs', 'tcRefs']

/** How the change line names a field. */
const FIELD_LABELS: Record<FrChangeField, string> = {
  title: 'title',
  description: 'description',
  priority: 'priority',
  complexity: 'complexity',
  endpoint: 'endpoint',
  requestBody: 'request body',
  securityRationale: 'security rationale',
  acceptanceCriteria: 'acceptance criteria',
  validationRules: 'validation rules'
}

/** A list changed by what it gains and loses, each entry matched by its exact text. */
export interface ListChange {
  add?: string[]
  remove?: string[]
}

export interface FrChanges {
  title?: string
  description?: string
  priority?: Priority
  complexity?: FrItem['complexity']
  endpoint?: string
  requestBody?: string
  securityRationale?: string
  /** A full array replaces the list and keeps its order; `{ add, remove }` edits it. */
  acceptanceCriteria?: string[] | ListChange
  validationRules?: string[] | ListChange
}

export interface UpdateFrPatch {
  kind: 'update-fr'
  frId: string
  changes: FrChanges
  /** The line the version's "What changed in this version" gains; worded from the patch when unset. */
  change?: string
  /** An annotation, echoed in the result and written nowhere. */
  note?: string
  /** The FR's own page, to take when its id is carried by several. */
  pageId?: string
  /** The version page that records the change, for an FR of an earlier version amended during later work. */
  versionPageId?: string
}

const PATCH_KEYS = ['kind', 'frId', 'changes', 'change', 'note', 'pageId', 'versionPageId']

function fail(message: string): never {
  throw new Error(`apply-srs-update: update-fr ${message}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') return fail(`${label} must be a non-empty string`)
  return value.trim()
}

function listItems(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) return fail(`${label} must be an array of strings`)
  return value.map((item, index) => {
    const text = requiredText(item, `${label}[${index}]`)
    if (text.includes('\n')) return fail(`${label}[${index}] must be a single line: a list entry is one bullet`)
    return text
  })
}

function listChange(value: unknown, label: string): string[] | ListChange {
  if (Array.isArray(value)) return listItems(value, label)
  if (!isRecord(value)) return fail(`${label} must be an array (the whole list) or { "add": […], "remove": […] }`)
  const unknown = Object.keys(value).filter((key) => key !== 'add' && key !== 'remove')
  if (unknown.length > 0) return fail(`${label} has unknown key "${unknown[0]}" (expected "add" and/or "remove")`)
  const change: ListChange = {}
  if (value.add !== undefined) change.add = listItems(value.add, `${label}.add`)
  if (value.remove !== undefined) change.remove = listItems(value.remove, `${label}.remove`)
  if ((change.add?.length ?? 0) === 0 && (change.remove?.length ?? 0) === 0) return fail(`${label} changes nothing: "add" and "remove" are both empty`)
  return change
}

/**
 * Checks an `update-fr` patch and returns it normalized (the id upper-cased, texts trimmed).
 * Everything it refuses is refused before the SRS is read.
 */
export function validateUpdateFrPatch(input: unknown): UpdateFrPatch {
  if (!isRecord(input)) return fail('patch must be a JSON object')
  const unknownKey = Object.keys(input).find((key) => !PATCH_KEYS.includes(key))
  if (unknownKey) return fail(`has unknown field "${unknownKey}" (expected ${PATCH_KEYS.join(', ')}); the fields to change go in "changes"`)

  const frId = requiredText(input.frId, '`frId`').toUpperCase()
  if (parseFrPageTitle(frId)?.id !== frId) return fail(`\`frId\` "${frId}" is not an FR id such as FR-AUTH-001`)

  if (!isRecord(input.changes)) return fail('needs `changes`: an object naming the fields to change')
  const raw = input.changes
  const changes: FrChanges = {}
  for (const key of Object.keys(raw)) {
    if (key === 'id') fail('cannot change the `id` of an FR: other pages and tickets refer to it')
    if (key === 'group') fail('cannot change the `group` of an FR here: it positions the row in the tables of the feature')
    if (REFERENCE_FIELDS.includes(key))
      fail(`cannot change \`${key}\` yet: the references are also listed in the tables of the UR, DS and TC (follow-up ${REFERENCES_FOLLOW_UP}). Change the references by hand.`)
    if (!(FR_CHANGE_FIELDS as readonly string[]).includes(key)) fail(`cannot change "${key}" (changeable: ${FR_CHANGE_FIELDS.join(', ')})`)
  }
  if (raw.title !== undefined) {
    const title = stripOwnIdPrefix(frId, requiredText(raw.title, '`changes.title`'))
    if (title.includes('\n')) fail('`changes.title` must be a single line')
    changes.title = title.trim()
  }
  for (const field of TEXT_FIELDS) if (raw[field] !== undefined) changes[field] = requiredText(raw[field], `\`changes.${field}\``)
  if (raw.priority !== undefined) {
    if (raw.priority !== 'P1' && raw.priority !== 'P2' && raw.priority !== 'P3') fail(`\`changes.priority\` must be P1, P2 or P3 (got ${JSON.stringify(raw.priority)})`)
    changes.priority = raw.priority as Priority
  }
  if (raw.complexity !== undefined) {
    if (!isComplexity(raw.complexity)) fail(`\`changes.complexity\` must be one of ${COMPLEXITIES.join(', ')} (got ${JSON.stringify(raw.complexity)})`)
    changes.complexity = raw.complexity
  }
  for (const field of LIST_FIELDS) if (raw[field] !== undefined) changes[field] = listChange(raw[field], `\`changes.${field}\``)
  if (Object.keys(changes).length === 0) fail('has empty `changes`: name at least one field to change')

  const patch: UpdateFrPatch = { kind: 'update-fr', frId, changes }
  if (input.change !== undefined) {
    patch.change = requiredText(input.change, '`change`')
    if (patch.change.includes('\n')) fail('`change` must be a single line: it is one bullet of the version')
  }
  if (input.note !== undefined) patch.note = requiredText(input.note, '`note`')
  if (input.pageId !== undefined) patch.pageId = requiredText(input.pageId, '`pageId`')
  if (input.versionPageId !== undefined) patch.versionPageId = requiredText(input.versionPageId, '`versionPageId`')
  return patch
}

/** A list after a change: the whole new list, or the old one without what `remove` names and with what `add` brings. */
export function mergeList(label: string, current: string[], change: string[] | ListChange): { next: string[]; warnings: string[] } {
  if (Array.isArray(change)) return { next: change, warnings: [] }
  const warnings: string[] = []
  let next = [...current]
  for (const item of change.remove ?? []) {
    if (!next.some((existing) => existing.trim() === item)) warnings.push(`${label}: "${shorten(item)}" is not in the list, so nothing was removed`)
    next = next.filter((existing) => existing.trim() !== item)
  }
  for (const item of change.add ?? []) if (!next.some((existing) => existing.trim() === item)) next.push(item)
  return { next, warnings }
}

function shorten(text: string): string {
  return text.length > 80 ? `${text.slice(0, 77)}…` : text
}

/** The FR as it reads once the patch is applied, and what the patch could not do. */
export function applyChanges(before: FrItem, changes: FrChanges): { after: FrItem; warnings: string[] } {
  const after: FrItem = { ...before }
  const warnings: string[] = []
  if (changes.title !== undefined) after.title = changes.title
  for (const field of TEXT_FIELDS) if (changes[field] !== undefined) after[field] = changes[field]
  if (changes.priority !== undefined) after.priority = changes.priority
  if (changes.complexity !== undefined) after.complexity = changes.complexity
  for (const field of LIST_FIELDS) {
    const change = changes[field]
    if (change === undefined) continue
    const merged = mergeList(FIELD_LABELS[field], before[field] ?? [], change)
    after[field] = merged.next
    warnings.push(...merged.warnings)
  }
  return { after, warnings }
}

/** What reverts the patch: the fields it names, as the FR held them. A field the FR left empty cannot be cleared again, so it is absent. */
export function revertChanges(before: FrItem, changes: FrChanges): FrChanges {
  const revert: FrChanges = {}
  for (const field of FR_CHANGE_FIELDS) {
    if (changes[field] === undefined) continue
    const value = before[field]
    if (value === undefined) continue
    if ((LIST_FIELDS as readonly string[]).includes(field)) revert[field as ListField] = [...(value as string[])]
    else (revert as Record<string, unknown>)[field] = value
  }
  return revert
}

/** The headings and the FR a page carries, read back from the page `renderFrPage` wrote. */
export function readFrPage(raw: RawContent, fr: Pick<SrsTreeFr, 'id' | 'title'>): { item: FrItem; headings: FrPageHeadings } | { error: string } {
  let heading = ''
  let summary: string | undefined
  let detail: { heading: string; rows: string[][] } | undefined
  for (const block of raw.blocks) {
    if (block.kind === 'heading') {
      heading = block.text.trim()
      continue
    }
    if (block.kind !== 'table' || !block.rows?.length) continue
    const header = block.rows[0].map((cell) => cell.trim().toLowerCase())
    if (!detail && header[0] === 'field') detail = { heading, rows: block.rows }
    else if (summary === undefined && header[0] === 'id' && header.includes('requirement')) summary = heading
  }
  if (!detail) return { error: 'its page has no Field/Value table to amend' }
  if (!detail.heading) return { error: 'its Field/Value table has no heading above it' }
  if (!summary) return { error: 'its page has no Summary table, or no heading above it' }
  return { item: readFrDetail(detail.rows, fr), headings: { summary, detail: detail.heading } }
}

export interface ChangedCell {
  page: 'fr' | 'version' | 'feature'
  pageId: string
  /** Where the cell sits, in words: `FR page › Description`. */
  where: string
  before: string
  after: string
}

export interface UpdateFrResult {
  kind: 'update-fr'
  frId: string
  /** The FR's own page. */
  targetPageId: string
  dryRun: boolean
  /** What changes (a dry run), or changed. Empty when the SRS already holds the patch. */
  changes: ChangedCell[]
  /** The fields as the FR held them: a revert patch's `changes`. */
  before: FrChanges
  /** The line the version's "What changed in this version" gains. */
  changeLine?: { pageId: string; versionTitle: string; text: string; status: 'added' | 'present' | 'would-add' | 'not-placed' }
  warnings?: string[]
  /** What the patch did not reach and is left to do by hand. */
  notPlaced?: string[]
  followUps?: string[]
  note?: string
}

/** A write that stopped midway: what is done, what is not, and the FR as it was. Applying the patch again completes it. */
export interface UpdateFrFailure {
  kind: 'update-fr'
  frId: string
  targetPageId: string
  error: string
  applied: string[]
  pending: string[]
  before: FrChanges
  rollbackHint: string
}

export type UpdateFrOutcome = { code: 0; result: UpdateFrResult } | { code: 2 | 5; message: string } | { code: 6; message: string; payload: UpdateFrFailure }

export interface UpdateFrContext {
  adapter: SrsAdapter
  /** The configured backend's name, for the message of a backend that cannot amend a page. */
  backend?: string
  rootPageId?: string
  dryRun: boolean
  /** Reads the board for the tickets that carry these FRs. Absent when the project has no board to read. */
  inspectTickets?: (requirements: ReconciliationRequirement[]) => ExistingSrsTicket[]
}

interface Step {
  page: ChangedCell['page']
  pageId: string
  pageLabel: string
  /** A page that cannot take it refuses the patch; the version and feature tables are reported instead. */
  required: boolean
  update: SectionUpdate
  /** The words for one cell of it (or for the heading and the title). */
  describe: (cell?: string) => string
}

interface PlannedStep {
  step: Step
  outcome: SectionUpdateOutcome
}

type UpdateSections = (pageId: string, updates: SectionUpdate[], options?: SectionUpdateOptions) => Promise<SectionUpdateOutcome[]>

function refuse(code: 2 | 5, message: string): UpdateFrOutcome {
  return { code, message: `✗ apply-srs-update: update-fr — ${message}\n` }
}

function buildSteps(fr: SrsTreeFr, before: FrItem, after: FrItem, headings: FrPageHeadings): Step[] {
  const frPage = (update: SectionUpdate): Step => ({
    page: 'fr',
    pageId: fr.pageId,
    pageLabel: 'FR page',
    required: true,
    update,
    describe: (cell) => {
      if (update.kind === 'heading') return 'FR page › heading'
      if (update.kind === 'title') return 'FR page › page title'
      return update.heading === headings.summary ? `FR page › summary › ${cell}` : `FR page › ${update.rowKey}`
    }
  })
  const steps = frPageUpdates(before, after, headings).map(frPage)
  if (fr.versionPageId) {
    const pageLabel = `version "${fr.version}"`
    steps.push(
      ...versionFrUpdates(before, after).map((update) => ({
        page: 'version' as const,
        pageId: fr.versionPageId!,
        pageLabel,
        required: false,
        update,
        describe: (cell?: string) => `${pageLabel} › FR table › ${cell}`
      }))
    )
  }
  const featureLabel = `feature "${fr.featureTitle}"`
  steps.push(
    ...featureFrUpdates(before, after).map((update) => ({
      page: 'feature' as const,
      pageId: fr.featurePageId,
      pageLabel: featureLabel,
      required: false,
      update,
      describe: (cell?: string) => `${featureLabel} › FR table › ${cell}`
    }))
  )
  return steps
}

/** Plans every step without writing: the adapter answers each with what the page holds now. */
async function planSteps(updateSections: UpdateSections, steps: Step[]): Promise<PlannedStep[]> {
  const planned = new Map<Step, SectionUpdateOutcome>()
  for (const pageId of [...new Set(steps.map((step) => step.pageId))]) {
    const group = steps.filter((step) => step.pageId === pageId)
    const outcomes = await updateSections(
      pageId,
      group.map((step) => step.update),
      { dryRun: true }
    )
    group.forEach((step, index) => planned.set(step, outcomes[index] ?? { status: 'unplaced', reason: 'the backend gave no answer for this update' }))
  }
  return steps.map((step) => ({ step, outcome: planned.get(step)! }))
}

function changedCellsOf({ step, outcome }: PlannedStep): ChangedCell[] {
  if (outcome.status !== 'updated') return []
  const { update } = step
  if (update.kind !== 'table-cells') return [{ page: step.page, pageId: step.pageId, where: step.describe(), before: String(outcome.before ?? ''), after: update.text }]
  const before = (outcome.before ?? {}) as Record<string, string>
  return Object.entries(update.cells)
    .filter(([name, text]) => (before[name] ?? '').trim() !== text.trim())
    .map(([name, text]) => ({ page: step.page, pageId: step.pageId, where: step.describe(name), before: before[name] ?? '', after: text }))
}

function describeStep(planned: PlannedStep): string {
  return changedCellsOf(planned)
    .map((cell) => cell.where)
    .join(', ')
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The Story spawned from the FR keeps the text the FR had: the result names it, since nothing rewrites it. */
function storyFollowUps(fr: SrsTreeFr, ctx: UpdateFrContext): string[] {
  const requirement: ReconciliationRequirement = { frId: fr.id, title: fr.title, frPageUrl: fr.url }
  const tail = `edit its body by hand — re-syncing a Story from its FR is tracked in ${STORY_FOLLOW_UP}.`
  if (!ctx.inspectTickets) return [`If a Story was spawned from ${fr.id}, it keeps the old text: ${tail}`]
  try {
    const found = findTicketsForFr(requirement, ctx.inspectTickets([requirement]))
    if (found.length === 0) return [`No Story spawned from ${fr.id} was found on the board. One that exists elsewhere keeps the old text: ${tail}`]
    return found.map((ticket) => `Story #${ticket.number} (${ticket.state.toLowerCase()}) was spawned from ${fr.id} and keeps the old text: ${tail}`)
  } catch (error) {
    return [`The board could not be read for the Story spawned from ${fr.id} (${shorten(messageOf(error))}). If there is one, it keeps the old text: ${tail}`]
  }
}

/**
 * Amends an FR in place. The order is deliberate: the FR page (the source of truth), the
 * version table, the feature table, then the version's change line, so the history never claims
 * a change the tables lack. Whatever stops the write midway, applying the patch again finishes
 * it: a cell already at its value is left alone and the change line is not repeated.
 */
export async function applyUpdateFr(input: UpdateFrPatch, ctx: UpdateFrContext): Promise<UpdateFrOutcome> {
  const patch = validateUpdateFrPatch(input)
  const { adapter } = ctx
  const updateSections: UpdateSections | undefined = adapter.updateSections?.bind(adapter)
  if (!updateSections) {
    return refuse(
      5,
      `the ${ctx.backend ? `"${ctx.backend}" ` : ''}SRS backend cannot change a page that already exists (its adapter has no \`updateSections\`). Nothing was written; change ${patch.frId} in the SRS by hand.`
    )
  }
  if (!ctx.rootPageId) return refuse(2, `${patch.frId} is found by its id in the SRS tree, which needs \`.saasfoundry.json → tools.srs.rootPage.id\`.`)

  const tree = await readSrsTree(adapter, ctx.rootPageId)
  if (!tree) return refuse(2, 'the SRS tree could not be read.')
  const found = locateFr(tree, patch.frId, patch.pageId)
  if (found.error !== undefined) return refuse(2, found.error)
  const fr = found.fr

  // The version page that records the change: the FR's own, or the one named for later work on an older FR
  let recording: { pageId: string; title: string } | undefined = fr.versionPageId ? { pageId: fr.versionPageId, title: fr.version ?? '' } : undefined
  if (patch.versionPageId) {
    const location = locatePage(tree, patch.versionPageId)
    if (location?.level !== 'version' || location.featurePageId !== fr.featurePageId || !location.versionPageId) {
      return refuse(2, `\`versionPageId\` ${patch.versionPageId} is not a version of "${fr.featureTitle}", the feature of ${fr.id}.`)
    }
    recording = { pageId: location.versionPageId, title: location.versionTitle ?? '' }
  }

  const layout = readFrPage(await adapter.fetchPage(fr.pageId), fr)
  if ('error' in layout) return refuse(2, `${fr.id}: ${layout.error}, so it is not amended.`)
  const { after, warnings } = applyChanges(layout.item, patch.changes)
  const before = revertChanges(layout.item, patch.changes)

  const steps = buildSteps(fr, layout.item, after, layout.headings)
  const planned = await planSteps(updateSections, steps)
  const blocking = planned.filter(({ step, outcome }) => step.required && outcome.status === 'unplaced')
  if (blocking.length > 0) {
    const reasons = blocking.map(({ step, outcome }) => `  - ${step.describe()}: ${outcome.reason}`).join('\n')
    return refuse(2, `${fr.id}'s page cannot take every change, so nothing was written (a page written before the Complexity row existed, or edited by hand, may differ):\n${reasons}`)
  }
  const notPlaced = planned
    .filter(({ step, outcome }) => !step.required && outcome.status === 'unplaced')
    .map(({ step, outcome }) => `${fr.id} on ${step.pageLabel}: ${outcome.reason} — change it by hand there.`)

  const fields = FR_CHANGE_FIELDS.filter((field) => patch.changes[field] !== undefined)
  const line = recording
    ? versionAmendmentLine(
        { id: fr.id, title: after.title },
        fields.map((field) => FIELD_LABELS[field]),
        patch.change
      )
    : undefined
  if (!recording) notPlaced.push(`${fr.id}: no version page lists it, so no change line was recorded.`)

  const result: UpdateFrResult = {
    kind: 'update-fr',
    frId: fr.id,
    targetPageId: fr.pageId,
    dryRun: ctx.dryRun,
    changes: planned.flatMap(changedCellsOf),
    before,
    ...(patch.note ? { note: patch.note } : {})
  }
  if (warnings.length > 0) result.warnings = warnings

  if (ctx.dryRun) {
    if (recording && line) {
      const present = await recordedLine(adapter, recording.pageId, line)
      result.changeLine = { pageId: recording.pageId, versionTitle: recording.title, text: line, status: present === 'no-section' ? 'not-placed' : present ? 'present' : 'would-add' }
      if (present === 'no-section') notPlaced.push(`${fr.id} on version "${recording.title}": no "${VERSION_HEADINGS.changes}" section — add the change line by hand.`)
    }
  } else {
    const writes = planned.filter(({ outcome }) => outcome.status === 'updated')
    const applied: string[] = []
    const stop = (error: unknown, at: PlannedStep | 'change line'): UpdateFrOutcome => {
      const index = typeof at === 'string' ? writes.length : writes.indexOf(at)
      const pending = [...writes.slice(index).map(describeStep), ...(recording && line ? ['version change line'] : [])].filter(Boolean)
      const message = messageOf(error)
      const failure: UpdateFrFailure = {
        kind: 'update-fr',
        frId: fr.id,
        targetPageId: fr.pageId,
        error: message,
        applied,
        pending,
        before,
        rollbackHint: `Applying the same patch again finishes it: a cell already at its value is left alone. To go back, apply an update-fr patch whose "changes" is this "before".`
      }
      return { code: 6, message: `✗ apply-srs-update: update-fr — the write of ${fr.id} stopped at ${typeof at === 'string' ? at : describeStep(at)}: ${message}\n`, payload: failure }
    }
    for (const write of writes) {
      try {
        const [outcome] = await updateSections(write.step.pageId, [write.step.update])
        if (outcome?.status === 'unplaced') throw new Error(outcome.reason ?? 'the page no longer holds it')
      } catch (error) {
        return stop(error, write)
      }
      applied.push(describeStep(write))
    }
    if (recording && line) {
      try {
        result.changeLine = await writeChangeLine(adapter, recording, line)
        if (result.changeLine.status === 'not-placed') notPlaced.push(`${fr.id} on version "${recording.title}": no "${VERSION_HEADINGS.changes}" section — add the change line by hand.`)
      } catch (error) {
        return stop(error, 'change line')
      }
    }
  }

  if (notPlaced.length > 0) result.notPlaced = notPlaced
  if (result.changes.length > 0) result.followUps = storyFollowUps(fr, ctx)
  return { code: 0, result }
}

/** Whether the version page already lists the line (or has no list to put it in). */
async function recordedLine(adapter: SrsAdapter, versionPageId: string, line: string): Promise<boolean | 'no-section'> {
  const raw = await adapter.fetchPage(versionPageId)
  const section = VERSION_HEADINGS.changes.toLowerCase()
  if (!raw.blocks.some((block) => block.kind === 'heading' && block.text.trim().toLowerCase() === section)) return 'no-section'
  return parseEpicPage(raw).changes.some((existing) => existing.trim() === line.trim())
}

async function writeChangeLine(adapter: SrsAdapter, recording: { pageId: string; title: string }, line: string): Promise<NonNullable<UpdateFrResult['changeLine']>> {
  const base = { pageId: recording.pageId, versionTitle: recording.title, text: line }
  if (!adapter.extendSections) return { ...base, status: 'not-placed' }
  const [outcome] = await adapter.extendSections(recording.pageId, versionAmendmentAdditions(line))
  return { ...base, status: outcome === 'extended' ? 'added' : outcome === 'unchanged' ? 'present' : 'not-placed' }
}
