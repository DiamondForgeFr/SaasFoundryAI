/**
 * The 32-hex id a page reference ends with, lowercase and without dashes, or `undefined`.
 *
 * One page reaches the CLI in several spellings: the dashed id the adapter returns, the
 * undashed id every Notion URL shows, a www.notion.so URL or an app.notion.com slug URL
 * (#927). Comparing references through this key treats them as the same page.
 */
export function pageKey(reference: string): string | undefined {
  const value = reference.trim()
  const compact = value.replace(/-/g, '')
  if (/^[0-9a-f]{32}$/i.test(compact)) return compact.toLowerCase()
  const path = value.split(/[?#]/)[0].replace(/\/+$/, '')
  return path.match(/([0-9a-f]{32})$/i)?.[1].toLowerCase()
}

/** Whether two page references name the same page, whatever their spelling. */
export function samePage(a: string, b: string): boolean {
  const key = pageKey(a)
  return key !== undefined && key === pageKey(b)
}
