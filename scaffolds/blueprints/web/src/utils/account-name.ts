/**
 * Types
 */
import type { TFunction } from 'i18next'

type AccountOwner = { firstname?: string; lastname?: string; email?: string }

/**
 * Methods
 */
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** The name of a person, from what is known so far: firstname + lastname → firstname → email user-part. */
function ownerName({ firstname, lastname, email }: AccountOwner): string {
  const fn = firstname?.trim()
  const ln = lastname?.trim()
  if (fn) return ln ? `${capitalize(fn)} ${capitalize(ln)}` : capitalize(fn)

  const e = email?.trim()
  if (!e?.includes('@')) return ''
  return capitalize(e.split('@')[0].split('+')[0].split(/[._-]/)[0])
}

/**
 * Whether a language that elides (French `de` → `d'`) elides before this name. A `y` elides before a consonant only
 * (Yves, not Yann), and an `h` never does: `de` is accepted before every `h`, `d'` only before a mute one.
 */
function startsWithVowel(name: string): boolean {
  const plain = name.normalize('NFD').replace(/\p{Diacritic}/gu, '')
  return /^(?:[aeiouæœø]|y(?![aeiouæœø]))/i.test(plain)
}

/**
 * Declaration
 */

/**
 * The account name suggested for its owner, in the language of `t`. The catalogs give one sentence, and a `vowel`
 * variant where the language needs it (`common.yml` > account): a language without it uses the plain one.
 */
export function suggestAccountName(t: TFunction<'common'>, owner: AccountOwner): string {
  const name = ownerName(owner)
  if (!name) return t('account.tk_main_')
  return t('account.tk_owned-by_', { name, context: startsWithVowel(name) ? 'vowel' : undefined })
}
