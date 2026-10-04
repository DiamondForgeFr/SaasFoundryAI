import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * #597 — the generated app's header read "SaaSFoundryAIAI": a blind find-and-replace inside a
 * literal already followed by `<span>AI</span>`.
 *
 * #886 — the wordmark was the generator's own name, shown to the generated app's end users. It
 * now renders the product name, `APP_NAME` from `src/lib/app.ts`, which `VITE_APP_NAME` sets.
 *
 * The generated project ships its own test suites, but CI never runs them (#594), so the guard
 * lives here: it reads the template and runs on every commit.
 */

const WEB = resolve(__dirname, '../../../../scaffolds/blueprints/web')
const LAYOUT = resolve(WEB, 'src/components/layout/layout-logged.tsx')

describe('generated app brand wordmark (#597, #886)', () => {
  const source = readFileSync(LAYOUT, 'utf8')

  it('never renders the AI suffix twice', () => {
    expect(source).not.toContain('SaaSFoundryAI<span')
    expect(source.replace(/\s+/g, '')).not.toContain('>AI</span><span')
  })

  it("renders the product name, never the generator's", () => {
    expect(source).toContain("import { APP_NAME } from '@/lib/app'")
    expect(source.replace(/\s+/g, '')).toContain('select-none">{APP_NAME}</span>')
    expect(source).not.toMatch(/>\s*(SaaS|Foundry|AI)\s*</)
  })

  it('reads the name from VITE_APP_NAME, the project name by default', () => {
    expect(readFileSync(resolve(WEB, 'src/lib/app.ts'), 'utf8')).toContain("import.meta.env.VITE_APP_NAME || '{{PROJECT_NAME}}'")
  })

  it('uses theme tokens, so the colours follow light and dark rather than being pinned to the SVG', () => {
    // The logo's #A1A1AA holds on dark chrome and loses contrast on light.
    expect(source).not.toContain('#A1A1AA')
    expect(source).not.toContain('#FF7C0D')
  })
})
