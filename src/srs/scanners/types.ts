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

export interface EntityFinding extends BaseScannerFinding {
  kind: 'entity'
  sourceFiles: string[]
}

export interface TestFinding extends BaseScannerFinding {
  kind: 'test'
  sourceFiles: string[]
}

export interface DocContextFinding extends BaseScannerFinding {
  kind: 'doc-context'
  sourceFiles: string[]
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
