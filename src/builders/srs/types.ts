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

export interface PageSection {
  heading?: string
  body: string
}

export interface PageContent {
  title?: string
  sections?: PageSection[]
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
