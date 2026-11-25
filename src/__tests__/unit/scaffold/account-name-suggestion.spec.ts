import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * #1081 — the account name suggested at activation and in the account-owner invitation was an
 * English template in the code, so a French user stored and displayed "Alice Martin's account".
 *
 * The behaviour is tested in the generated project (`account-name.test.tsx`, `auth.spec.ts` and the
 * API's `auth.service.spec.ts`). These guards run here, on the templates.
 */

const SCAFFOLDS = resolve(__dirname, '../../../../scaffolds')
const read = (file: string) => readFileSync(join(SCAFFOLDS, file), 'utf8')

const webSources = ['blueprints/web/src', 'overlays/monorepo/web/src', 'overlays/multirepo/web/src', 'overlays/modules'].flatMap((dir) =>
  readdirSync(join(SCAFFOLDS, dir), { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.tsx?$/.test(file) && !/\.(test|spec)\.tsx?$/.test(file))
    .map((file) => join(dir, file))
)

describe('the suggested account name comes from the i18n catalog (#1081)', () => {
  it('no web source builds an English account name', () => {
    expect(webSources.length).toBeGreaterThan(100)
    expect(webSources.filter((file) => /\}['’]s account|['"`]Main account['"`]/.test(read(file)))).toEqual([])
  })

  it.each(['blueprints/web/src/pages/public/auth/signin.tsx', 'blueprints/web/src/components/dialogs/invite-account-owner-dialog.tsx'])(
    '%s suggests a name in the current language, and only until the user types one',
    (file) => {
      const source = read(file)
      expect(source).toContain("from '@/utils/account-name'")
      expect(source).toMatch(/if \(form\.formState\.dirtyFields\.accountName\) return\n\s+const suggested = suggestAccountName\(tCommon, /)
      expect(source).toMatch(/\}, \[[^\]]*\btCommon\]\)/)
    }
  )

  it.each([
    ['en', { main: 'Main account', ownedBy: `"{{ name }}'s account"` }],
    ['fr', { main: 'Compte principal', ownedBy: 'Compte de {{ name }}', vowel: "Compte d'{{ name }}" }]
  ])('the %s catalog has the sentences', (language, expected) => {
    const account = read(`blueprints/web/src/locales/${language}/common.yml`).match(/^account:\n((?: {2}.*\n)+)/m)?.[1] ?? ''
    const sentence = (key: string) => account.match(new RegExp(`^ {2}${key}: (.*)$`, 'm'))?.[1]
    expect({ main: sentence('tk_main_'), ownedBy: sentence('tk_owned-by_'), vowel: sentence('tk_owned-by__vowel') }).toEqual(expected)
  })

  it('the API names an account in the locale of the user who gave no name', () => {
    expect(read('blueprints/api/src/configs/db/user.config.ts')).toMatch(/accountName: \{\s+\[Locale\.EN\]: 'Main account',\s+\[Locale\.FR\]: 'Compte principal'\s+\}/)
    expect(read('blueprints/api/src/modules/auth/services/auth.service.ts')).toContain('data: { name: accountName?.trim() || UserDefaults.accountName[locale || UserDefaults.preferences.locale] }')
  })
})
