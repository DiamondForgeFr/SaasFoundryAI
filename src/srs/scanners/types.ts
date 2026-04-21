export type ScannerFindingKind = 'endpoint' | 'ui-flow' | 'entity' | 'test' | 'doc-context'

export interface ScannerFinding {
  kind: ScannerFindingKind
  title: string
  sourceFiles: string[]
  excerpt?: string
  notes?: string
}

export interface CodebaseScannerContext {
  scanRoot: string
  files: string[]
}

export interface CodebaseScanner {
  id: string
  describe: string
  collect(context: CodebaseScannerContext): Promise<ScannerFinding[]>
}
