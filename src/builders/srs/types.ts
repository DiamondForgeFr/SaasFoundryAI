export interface PageRef {
  id: string
  url: string
  title: string
}

export type Priority = 'P1' | 'P2' | 'P3'

export interface UrItem {
  id: string
  narrative: string
  businessValue?: string
  priority?: Priority
  group?: string
}

export interface FrItem {
  id: string
  title: string
  description?: string
  acceptanceCriteria?: string[]
  urRefs?: string[]
  dsRefs?: string[]
  tcRefs?: string[]
  priority?: Priority
  group?: string
  endpoint?: string
  requestBody?: string
  validationRules?: string[]
  securityRationale?: string
}

/** An FR shown on its feature's page, with the version it belongs to. */
export interface VersionFrItem extends FrItem {
  version: string
}

export interface DsItem {
  id: string
  title: string
  description?: string
  frRefs?: string[]
  group?: string
}

export interface TcItem {
  id: string
  title: string
  steps?: string[]
  expectedResult?: string
  frRefs?: string[]
}

export interface NfrItem {
  id: string
  title: string
  target?: string
  priority?: Priority
  frRefs?: string[]
  group?: string
}

/** An item with the title of the version that brought it. */
export type Versioned<T> = T & { version: string }

/** Requirements a feature's versions bring, for the feature page's tables (#900). */
export interface VersionItems {
  urs: Versioned<UrItem>[]
  dsItems: Versioned<DsItem>[]
  tcItems: Versioned<TcItem>[]
  nfrItems: Versioned<NfrItem>[]
}

export interface EpicSpec {
  title: string
  parentPageId: string
  id?: string
  /**
   * Logical id of the feature this page sits under, resolved within the batch —
   * the mechanism `FrSpec.parentEpicId` already uses.
   *
   * **Its presence is what makes this page a version.** The level comes from
   * position, never from the title, exactly as the traversal reads it: a version
   * is called `MVP`, `V1` or `v2 — Titre` depending on who wrote it.
   */
  parentId?: string
  /** Content specific to a version page. Ignored on a feature. */
  version?: { changes?: string[] }
  /**
   * Titles of the versions declared under this feature in the same batch.
   *
   * Derived by `write-srs` from the batch, never authored: the feature page is
   * created before its versions exist, and `updatePage` appends rather than
   * replaces, so indexing afterwards would duplicate the list on every re-run.
   */
  versions?: string[]
  /**
   * The FRs of the versions declared under this feature in the same batch, each with the
   * title of its version. Derived by `write-srs`, never authored, like `versions`: in the
   * three-level model `frs` is empty on a feature, so its UR and DS tables could link no FR
   * and its FR table stayed empty (#850).
   */
  versionFrs?: VersionFrItem[]
  /**
   * The UR / DS / TC / NFR items its versions and their FRs carry, each with the title of its
   * version. Derived by `write-srs`, never authored: the feature page is the register of its
   * requirements, and these items were rendered nowhere (#900).
   */
  versionItems?: VersionItems
  businessValue?: string
  scope?: string
  urs: UrItem[]
  frs: FrItem[]
  dsItems?: DsItem[]
  tcItems?: TcItem[]
  nfrItems?: NfrItem[]
}

export interface FrSpec {
  parentEpicPageId?: string
  parentEpicId?: string
  fr: FrItem
  urs?: UrItem[]
  dsItems?: DsItem[]
  tcItems?: TcItem[]
}

export interface HeadingBlock {
  kind: 'heading'
  level: 1 | 2 | 3
  text: string
}

export interface ParagraphBlock {
  kind: 'paragraph'
  text: string
}

export interface BulletedListBlock {
  kind: 'bulleted_list'
  items: string[]
}

export interface NumberedListBlock {
  kind: 'numbered_list'
  items: string[]
}

export interface TableBlock {
  kind: 'table'
  header: string[]
  rows: string[][]
}

export interface CodeBlock {
  kind: 'code'
  language?: string
  text: string
}

export interface DividerBlock {
  kind: 'divider'
}

export type PageBlock = HeadingBlock | ParagraphBlock | BulletedListBlock | NumberedListBlock | TableBlock | CodeBlock | DividerBlock

export interface PageContent {
  title?: string
  blocks: PageBlock[]
}

export interface FrPageLink {
  frId: string
  frTitle: string
  pageUrl?: string
}

export interface EpicTicketBodySpec {
  epic: EpicSpec
  epicPageUrl?: string
  frPages?: FrPageLink[]
  scopeIncluded?: string[]
  scopeExcluded?: string[]
  dependencies?: string[]
  constraints?: string[]
  assumptions?: string[]
  definitionOfDone?: string[]
  version?: number | string
  startDate?: string
  endDate?: string
}

export interface AcceptanceCriterion {
  id: string
  text: string
  sourceFr?: string
}

export interface DsRef {
  id: string
  title?: string
}

export interface StoryTicketBodySpec {
  fr: FrItem
  frPageUrl?: string
  mainSpecUrl?: string
  urRefs?: UrItem[]
  frRefs?: Array<{ id: string; title?: string }>
  acceptanceCriteria?: AcceptanceCriterion[]
  dsRefs?: DsRef[]
  dependencies?: string[]
  constraints?: string[]
}

export interface CompletionCriterion {
  id: string
  text: string
}

export interface SpecLink {
  label: string
  url: string
}

export interface TaskTicketBodySpec {
  title: string
  objective?: string
  context?: string
  parentEpicUrl?: string
  parentStoryUrl?: string
  scopeIncluded?: string[]
  scopeExcluded?: string[]
  completionCriteria?: CompletionCriterion[]
  specLinks?: SpecLink[]
  dependencies?: string[]
  constraints?: string[]
}

export interface IssueTicketBodySpec {
  title: string
  behaviorObserved?: string
  expectedBehavior?: string
  stepsToReproduce?: string[]
  environment?: string[]
  impact?: string
  severity?: 'low' | 'medium' | 'high' | 'critical'
  evidence?: string[]
}

export interface ResolvedParent {
  id: string
  name: string
  url?: string
}

export interface RawContent {
  pageId: string
  title: string
  url: string
  blocks: Array<{
    kind: 'heading' | 'paragraph' | 'list' | 'table' | 'other'
    text: string
    /** A table's cells, row by row, its header row first. Absent when the backend does not read them. */
    rows?: string[][]
  }>
  children?: RawContent[]
}

export interface DraftCandidateSource {
  kind: 'notion-pages' | 'codebase'
  pageIds?: string[]
  files?: string[]
  excerpt?: string
}

export interface DraftCandidate {
  kind: 'epic' | 'fr'
  confidence: 'high' | 'medium' | 'low'
  epic?: EpicSpec
  fr?: FrSpec
  source: DraftCandidateSource
  notes?: string
}

/**
 * An addition to one section of an existing page: the content under `heading`, up to the next
 * heading. A feature written in an earlier batch gains a version and its requirements this way,
 * where `updatePage` could only append to the end of the page (#899, #900).
 */
export type SectionAddition =
  | {
      kind: 'list-items'
      heading: string
      /** Added after the section's last bullet; an item already listed is not repeated. */
      items: string[]
      /** A missing section is created right before this heading, opened by `intro`. */
      createBefore?: string
      intro?: string
    }
  | {
      kind: 'table-rows'
      heading: string
      /**
       * The same rows in each table shape the section may have, most complete first: the
       * section's table width picks one. A row whose first cell is already in the table is
       * not repeated. A section holding only its "No … yet." placeholder gets a table of the
       * first shape in place of it.
       */
      layouts: Array<{ header: string[]; rows: string[][] }>
    }

/** `extended`: added in place. `unchanged`: every entry was already there. `unplaced`: no section, or no table of a known shape, to add to. */
export type SectionAdditionOutcome = 'extended' | 'unchanged' | 'unplaced'

export interface SrsAdapter {
  init(): Promise<void>

  resolveParent(input: string): Promise<ResolvedParent>

  createPage(parentPageId: string, title: string, content?: PageContent): Promise<PageRef>

  createEpicPage(spec: EpicSpec): Promise<PageRef>

  createFrPage(spec: FrSpec): Promise<PageRef>

  updatePage(pageId: string, content: PageContent): Promise<void>

  fetchPage(pageId: string): Promise<RawContent>

  listChildren(parentPageId: string): Promise<PageRef[]>

  /**
   * Reparents an existing page.
   *
   * The page is **moved**, not recreated: its id, URL, body and comments survive,
   * so every existing link into the SRS keeps working. `sf srs normalize` depends
   * on that — recreating 196 FR pages would break every reference to them.
   */
  move(pageId: string, newParentPageId: string): Promise<void>

  /**
   * Adds to sections of an existing page, in place, one outcome per addition. Optional: a
   * backend without it leaves the caller to report what could not be placed.
   */
  extendSections?(pageId: string, additions: SectionAddition[]): Promise<SectionAdditionOutcome[]>
}
