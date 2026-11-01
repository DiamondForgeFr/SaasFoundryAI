import { pageKey, samePage } from '../../../srs/page-key'

// #927 — one Notion page, several spellings
describe('pageKey', () => {
  const key = '3f2a31bb4f3f8101bac0efcf1cd84347'

  it.each([
    ['a dashed id', '3f2a31bb-4f3f-8101-bac0-efcf1cd84347'],
    ['an undashed id', key],
    ['an uppercase id', key.toUpperCase()],
    ['a www.notion.so URL', `https://www.notion.so/${key}`],
    ['an app.notion.com slug URL with a query', `https://app.notion.com/p/v2-Live-notes-${key}?pvs=4`],
    ['a URL with a trailing slash and a fragment', `https://www.notion.so/Page-${key}/#section`]
  ])('reads %s', (_label, reference) => {
    expect(pageKey(reference)).toBe(key)
  })

  it('reads nothing from a title or a URL without an id', () => {
    expect(pageKey('v2 — Prise de notes vivante')).toBeUndefined()
    expect(pageKey('https://example.test/v2')).toBeUndefined()
  })

  it('compares two spellings of one page, never two pages without an id', () => {
    expect(samePage('3f2a31bb-4f3f-8101-bac0-efcf1cd84347', `https://app.notion.com/p/x-${key}`)).toBe(true)
    expect(samePage('v1', 'v1')).toBe(false)
  })
})
