import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * #597 — the generated app's header read "SaaSFoundryAIAI".
 *
 * The rebrand replaced `SaaSFoundry` with `SaaSFoundryAI` inside a literal that was
 * already followed by a `<span>AI</span>`. The same edit made the same mistake in the SVG
 * logo (#567), and that one was found first — this is the second occurrence of one blind
 * find-and-replace.
 *
 * The generated project ships its own test suites, but CI never runs them (#594), so the
 * guard lives here: it reads the template and runs on every commit.
 */

const LAYOUT = resolve(__dirname, '../../../../scaffolds/blueprints/web/src/components/layout/layout-logged.tsx')

describe('generated app brand wordmark (#597)', () => {
  const source = readFileSync(LAYOUT, 'utf8')

  it('never renders the AI suffix twice', () => {
    expect(source).not.toContain('SaaSFoundryAI<span')
    expect(source.replace(/\s+/g, '')).not.toContain('>AI</span><span')
  })

  it('splits the wordmark into the logo’s three segments', () => {
    const compact = source.replace(/\s+/g, '')
    expect(compact).toContain('<spanclassName="text-primary">SaaS</span>')
    expect(compact).toContain('<spanclassName="text-muted-foreground">Foundry</span>')
    expect(compact).toContain('<spanclassName="text-primary">AI</span>')
  })

  it('keeps it one word — the segments are adjacent, with no separator between them', () => {
    const compact = source.replace(/\s+/g, '')
    const oneWord = '<spanclassName="text-primary">SaaS</span><spanclassName="text-muted-foreground">Foundry</span><spanclassName="text-primary">AI</span>'
    expect(compact).toContain(oneWord)
  })

  it('uses theme tokens, so the colours follow light and dark rather than being pinned to the SVG', () => {
    // The logo's #A1A1AA holds on dark chrome and loses contrast on light.
    expect(source).not.toContain('#A1A1AA')
    expect(source).not.toContain('#FF7C0D')
  })
})
