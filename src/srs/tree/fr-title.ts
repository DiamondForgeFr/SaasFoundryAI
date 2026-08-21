import { FR_TITLE_SEPARATOR } from '../../builders/srs/constants'

// FR page titles follow `FR-AREA-NN[-MM]${FR_TITLE_SEPARATOR}Title` (em-dash,
// U+2014) produced by `renderFrPage`. The parser accepts the canonical
// separator and tolerates colon or hyphen as fallbacks for resilience against
// manual edits in Notion.
// The area may span several hyphen-separated segments (`FR-CONFIG-ENGINE-01`), so each
// segment is required to carry at least one letter. That is what keeps the trailing
// numeric group (`-01`, `-01-02`) out of the area. The previous pattern accepted a single
// alphanumeric segment, so every multi-segment id failed to parse and its page was
// dropped from the inventory without a word — silently deflating every FR total.
const FR_AREA_SEGMENT = '[A-Z0-9]*[A-Z][A-Z0-9]*'
const FR_ID_RE = new RegExp(`^(FR-(${FR_AREA_SEGMENT}(?:-${FR_AREA_SEGMENT})*)(?:-\\d+)+)`, 'i')
const CANONICAL_SEP_CHAR = FR_TITLE_SEPARATOR.trim()
const SEPARATOR_RE = new RegExp(`^\\s*[${CANONICAL_SEP_CHAR}:\\-]\\s*`)

export interface ParsedFrTitle {
  id: string
  area: string
  title: string
}

/**
 * The single FR title parser in the codebase.
 *
 * It lives here rather than under `eval/` because both the freshness evaluation
 * and the ticket spawner need it, and the two used to carry divergent regexes —
 * `spawn` accepted `FR-\d+` only, so every real `FR-LIVE-007` failed it and got
 * fabricated into a ticket from its raw title. One parser, one definition of
 * what an FR page title is.
 */
export function parseFrPageTitle(raw: string): ParsedFrTitle | null {
  const trimmed = raw.trim()
  const match = trimmed.match(FR_ID_RE)
  if (!match) return null
  const id = match[1].toUpperCase()
  const area = match[2].toLowerCase()
  const rest = trimmed.slice(match[0].length).replace(SEPARATOR_RE, '')
  const title = rest.length > 0 ? rest : id
  return { id, area, title }
}
