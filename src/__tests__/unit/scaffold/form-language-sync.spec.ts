import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * #983 — the validation errors a generated form displayed stayed in the language of the moment.
 *
 * The behaviour is tested in the generated project (`useFormLanguageSync.test.tsx`). These guards
 * run here, on the templates: no form may take a Zod resolver without following the language, and
 * the messages of the form schemas exist in both languages.
 */

const SCAFFOLDS = resolve(__dirname, '../../../../scaffolds')

const sourcesUnder = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
    .map((file) => join(dir, file))

const forms = ['blueprints/web/src', 'overlays/monorepo/web/src', 'overlays/multirepo/web/src', 'overlays/modules']
  .flatMap((dir) => sourcesUnder(resolve(SCAFFOLDS, dir)))
  .filter((file) => readFileSync(file, 'utf8').includes('zodResolver('))
  .map((file) => file.slice(SCAFFOLDS.length + 1))

describe('generated forms follow the current language (#983)', () => {
  it('finds the generated forms', () => {
    expect(forms.length).toBeGreaterThanOrEqual(8)
  })

  it.each(forms)('%s keeps its displayed errors in the current language', (file) => {
    const source = readFileSync(join(SCAFFOLDS, file), 'utf8')
    expect(source).toContain("from '@/hooks/ui/useFormLanguageSync'")
    expect(source.match(/\buseFormLanguageSync\(form\b/g)).toHaveLength(source.match(/\buseForm</g)!.length)
  })

  it.each(forms)('%s translates every error it sets itself', (file) => {
    const source = readFileSync(join(SCAFFOLDS, file), 'utf8')
    const declared = source.match(/useFormLanguageSync\(form, (\{.*\})\)/)?.[1] ?? ''
    for (const [, type] of source.matchAll(/form\.setError\([^,]+, \{ type: '([^']+)'/g)) expect(declared).toContain(`'${type}':`)
  })

  it('translates the invitation email error in both languages', () => {
    for (const language of ['en', 'fr']) {
      expect(readFileSync(join(SCAFFOLDS, `blueprints/web/src/locales/${language}/common.yml`), 'utf8')).toMatch(/^ {4}tk_emailError_: \S/m)
    }
  })
})
