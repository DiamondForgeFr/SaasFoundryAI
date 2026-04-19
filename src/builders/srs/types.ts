export interface PageRef {
  id: string
  url: string
  title: string
}

export interface UrItem {
  id: string
  narrative: string
  businessValue?: string
}

export interface FrItem {
  id: string
  title: string
  description?: string
  acceptanceCriteria?: string[]
  urRefs?: string[]
  dsRefs?: string[]
  tcRefs?: string[]
}

export interface DsItem {
  id: string
  title: string
  description?: string
  frRefs?: string[]
}

export interface TcItem {
  id: string
  title: string
  steps?: string[]
  expectedResult?: string
  frRefs?: string[]
}

export interface EpicSpec {
  title: string
  parentPageId: string
  businessValue?: string
  scope?: string
  urs: UrItem[]
  frs: FrItem[]
  dsItems?: DsItem[]
  tcItems?: TcItem[]
}

export interface FrSpec {
  parentEpicPageId: string
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

export interface RawContent {
  pageId: string
  title: string
  url: string
  blocks: Array<{
    kind: 'heading' | 'paragraph' | 'list' | 'table' | 'other'
    text: string
  }>
  children?: RawContent[]
}

export interface SrsAdapter {
  init(): Promise<void>

  createEpicPage(spec: EpicSpec): Promise<PageRef>

  createFrPage(spec: FrSpec): Promise<PageRef>

  updatePage(pageId: string, content: PageContent): Promise<void>

  fetchPage(pageId: string): Promise<RawContent>

  listChildren(parentPageId: string): Promise<PageRef[]>
}
