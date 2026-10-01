import { layoutNamedImports, layoutStringProperties } from '../../../utils/source-layout'

const ours = (module: string) => module.startsWith('@acme/')

describe('layoutNamedImports (#867)', () => {
  it('keeps an import that fits on one line, and joins one spread over several', () => {
    expect(layoutNamedImports("import { A, B } from '@acme/ui'", ours, 40)).toBe("import { A, B } from '@acme/ui'")
    expect(layoutNamedImports("import {\n  A,\n  B\n} from '@acme/ui'", ours, 40)).toBe("import { A, B } from '@acme/ui'")
  })

  it('spreads an import that does not fit, one specifier per line and no trailing comma', () => {
    const spread = "import type Layout, {\n  Sidebar,\n  SidebarContent\n} from '@acme/ui/sidebar'"
    expect(layoutNamedImports("import type Layout, { Sidebar, SidebarContent } from '@acme/ui/sidebar'", ours, 60)).toBe(spread)
    expect(layoutNamedImports(spread, ours, 60)).toBe(spread)
  })

  it('leaves other modules, and imports carrying a comment, as written', () => {
    const source = "import {\n  A, // why\n  B\n} from '@acme/ui'\nimport {\n  C\n} from 'react'"
    expect(layoutNamedImports(source, ours, 200)).toBe(source)
  })
})

describe('layoutStringProperties (#867)', () => {
  it('breaks a property after its colon only when the line does not fit', () => {
    expect(layoutStringProperties("  title: 'Welcome to ACME',", 40)).toBe("  title: 'Welcome to ACME',")
    expect(layoutStringProperties("  title: 'Welcome to ACME COMPLIANCE PLATFORM',", 40)).toBe("  title:\n    'Welcome to ACME COMPLIANCE PLATFORM',")
  })

  it('joins a broken property that fits again, whatever its quotes', () => {
    expect(layoutStringProperties('  body:\n    "l\'équipe ACME",', 40)).toBe('  body: "l\'équipe ACME",')
  })
})
