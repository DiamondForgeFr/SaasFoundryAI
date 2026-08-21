import { FR_TITLE_SEPARATOR } from '../../../../builders/srs/constants'
import { composeFrTitle, stripOwnIdPrefix, titleCarriesOwnId } from '../../../../builders/srs/fr-title-format'
import { renderFrPage } from '../../../../builders/srs/templates/pages/fr.tpl'
import { FrSpec } from '../../../../builders/srs/types'

function spec(id: string, title: string): FrSpec {
  return { parentEpicPageId: 'epic', fr: { id, title, priority: 'P1' } }
}

describe('composeFrTitle', () => {
  it('composes the canonical shape when the title carries no id', () => {
    expect(composeFrTitle('FR-LIVE-011', 'Liens qualifiés')).toBe(`FR-LIVE-011${FR_TITLE_SEPARATOR}Liens qualifiés`)
  })

  // The bug: two real Notion pages read "FR-LIVE-011 — FR-LIVE-011 — Liens qualifiés…".
  // Not hand-entry — the composer concatenated id + title without looking.
  it('does not repeat an id the title already carries', () => {
    expect(composeFrTitle('FR-LIVE-011', 'FR-LIVE-011 — Liens qualifiés')).toBe(`FR-LIVE-011${FR_TITLE_SEPARATOR}Liens qualifiés`)
  })

  it.each([
    ['FR-COMPANION-009 — Souffles', 'em-dash'],
    ['FR-COMPANION-009: Souffles', 'colon'],
    ['FR-COMPANION-009 - Souffles', 'hyphen'],
    ['fr-companion-009 — Souffles', 'lowercase id']
  ])('strips "%s" (%s)', (title) => {
    expect(composeFrTitle('FR-COMPANION-009', title)).toBe(`FR-COMPANION-009${FR_TITLE_SEPARATOR}Souffles`)
  })

  // A cross-reference is not a duplication.
  it('leaves a title naming a different FR alone', () => {
    const title = 'FR-AUTH-01 — see also'
    expect(composeFrTitle('FR-AUTH-02', title)).toBe(`FR-AUTH-02${FR_TITLE_SEPARATOR}${title}`)
  })

  it('keeps a title that is nothing but its own id, rather than emptying it', () => {
    expect(composeFrTitle('FR-AUTH-01', 'FR-AUTH-01')).toBe(`FR-AUTH-01${FR_TITLE_SEPARATOR}FR-AUTH-01`)
  })
})

describe('titleCarriesOwnId', () => {
  it('detects its own id and ignores another one', () => {
    expect(titleCarriesOwnId('FR-AUTH-01', 'FR-AUTH-01 — Sign in')).toBe(true)
    expect(titleCarriesOwnId('FR-AUTH-02', 'FR-AUTH-01 — Sign in')).toBe(false)
    expect(titleCarriesOwnId('FR-AUTH-01', 'Sign in')).toBe(false)
  })

  it('does not fire on an id that merely appears mid-title', () => {
    expect(titleCarriesOwnId('FR-AUTH-01', 'Sign in, see FR-AUTH-01')).toBe(false)
  })
})

describe('stripOwnIdPrefix', () => {
  it('returns the title untouched when there is nothing to strip', () => {
    expect(stripOwnIdPrefix('FR-AUTH-01', 'Sign in')).toBe('Sign in')
  })
})

describe('renderFrPage', () => {
  it('renders the page title once, and the detail heading once', () => {
    const page = renderFrPage(spec('FR-LIVE-011', 'FR-LIVE-011 — Liens qualifiés'))
    expect(page.title).toBe(`FR-LIVE-011${FR_TITLE_SEPARATOR}Liens qualifiés`)
    const headings = page.blocks.filter((b): b is { kind: 'heading'; level: 1 | 2 | 3; text: string } => b.kind === 'heading')
    expect(headings.map((h) => h.text)).toContain(`FR-LIVE-011${FR_TITLE_SEPARATOR}Liens qualifiés`)
  })
})
