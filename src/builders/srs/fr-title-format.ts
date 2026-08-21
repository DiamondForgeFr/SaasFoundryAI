import { FR_TITLE_SEPARATOR } from './constants'

// The composition side of the FR title grammar. The parsing side lives in
// `src/srs/tree/fr-title.ts`; the two must agree on the same separator, which is
// why both read it from `constants.ts`.

const SEPARATOR_CHAR = FR_TITLE_SEPARATOR.trim()

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * True when `title` already opens with `id` followed by a separator.
 *
 * A title naming a *different* FR is left alone: `"FR-AUTH-02 — see FR-AUTH-01"`
 * is a legitimate cross-reference, not a duplication.
 */
export function titleCarriesOwnId(id: string, title: string): boolean {
  return ownIdPrefix(id).test(title)
}

/**
 * Removes a leading `<id><separator>` from a title when the id is the FR's own.
 *
 * Drafters legitimately pass either form — `"Liens qualifiés"` or the full
 * `"FR-LIVE-011 — Liens qualifiés"` — and the composer used to concatenate blindly,
 * which is how `FR-LIVE-011 — FR-LIVE-011 — Liens qualifiés…` reached Notion. The
 * id is not lost: it is re-added by `composeFrTitle`.
 */
export function stripOwnIdPrefix(id: string, title: string): string {
  const stripped = title.replace(ownIdPrefix(id), '')
  // A title that is nothing but its own id has no text left to keep.
  return stripped.trim().length > 0 ? stripped : title
}

/** The single place an FR page title is assembled. */
export function composeFrTitle(id: string, title: string): string {
  return `${id}${FR_TITLE_SEPARATOR}${stripOwnIdPrefix(id, title)}`
}

function ownIdPrefix(id: string): RegExp {
  // The separator tolerance matches the parser's: canonical em-dash, plus colon
  // and hyphen for titles typed by hand in Notion.
  return new RegExp(`^\\s*${escapeForRegExp(id)}\\s*[${SEPARATOR_CHAR}:-]\\s*`, 'i')
}
