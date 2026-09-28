export type ScannerFindingKind = 'endpoint' | 'ui-flow' | 'entity' | 'test' | 'doc-context'

export interface BaseScannerFinding {
  kind: ScannerFindingKind
  title: string
  excerpt?: string
  notes?: string
}

export interface EndpointFinding extends BaseScannerFinding {
  kind: 'endpoint'
  area: string
  file: string
  method: string
  path: string
  hasTests: boolean
}

export interface UiFlowFinding extends BaseScannerFinding {
  kind: 'ui-flow'
  area: string
  file: string
  route?: string
  formFields: string[]
  linkedEndpointGuess?: string
}

export interface EntityField {
  name: string
  type: string
  optional?: boolean
  isId?: boolean
}

export interface EntityRelation {
  field: string
  target: string
}

export interface EntityFinding extends BaseScannerFinding {
  kind: 'entity'
  area: string
  file: string
  model: string
  fields: EntityField[]
  relations: EntityRelation[]
}

export interface TestFinding extends BaseScannerFinding {
  kind: 'test'
  area: string
  file: string
  describe: string
  cases: string[]
}

export interface DocContextFinding extends BaseScannerFinding {
  kind: 'doc-context'
  area: string
  file: string
  heading: string
  headingLevel: 1 | 2 | 3
  excerpt: string
}

export type ScannerFinding = EndpointFinding | UiFlowFinding | EntityFinding | TestFinding | DocContextFinding

export interface CodebaseScannerContext {
  scanRoot: string
  files: string[]
  structure?: 'monorepo' | 'multirepo'
  apiRoot?: string
  webRoot?: string
}

export interface CodebaseScanner {
  id: string
  describe: string
  collect(context: CodebaseScannerContext): Promise<ScannerFinding[]>
}
