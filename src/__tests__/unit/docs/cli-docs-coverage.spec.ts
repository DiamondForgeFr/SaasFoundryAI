import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * #625 — the documentation could not notice that a command had been added.
 *
 * `sf resume` shipped in #588 and `sf srs` had existed for far longer; neither had a page.
 * `scripts/generate-cli-docs.ts` opened with "extracts command information from the CLI
 * implementation" and did nothing of the sort — line 66 was a hand-written array of eight
 * commands, so a command added to `src/index.ts` could never appear in its output.
 *
 * This test is the part that keeps it true. Everything else in that ticket was a one-time
 * catch-up; without a check that fails, the next command ships undocumented too.
 */

const root = resolve(__dirname, '../../../..')

/** Every command Commander actually registers. */
const registered = (): string[] => {
  const source = readFileSync(resolve(root, 'src/index.ts'), 'utf8')
  return [...source.matchAll(/\.command\('([a-z-]+)'/g)].map((m) => m[1]).sort()
}

/** Every command the documentation has a page for. */
const documented = (): string[] =>
  readdirSync(resolve(root, 'docs/cli'))
    .filter((f) => f.startsWith('sf-') && f.endsWith('.md'))
    .map((f) => f.slice('sf-'.length, -'.md'.length))
    .sort()

describe('the documentation notices when a command is added (#625)', () => {
  it('finds commands to check', () => {
    expect(registered().length).toBeGreaterThan(5)
  })

  it('has a page for every registered command', () => {
    const missing = registered().filter((c) => !documented().includes(c))
    // Naming them rather than counting them: the failure should say which command to write
    // a page for, not that a number changed.
    expect(missing).toEqual([])
  })

  it('has no page for a command that no longer exists', () => {
    const orphaned = documented().filter((c) => !registered().includes(c))
    expect(orphaned).toEqual([])
  })

  it('gives each page a title naming its command', () => {
    for (const command of documented()) {
      const page = readFileSync(resolve(root, `docs/cli/sf-${command}.md`), 'utf8')
      expect(page.split('\n')[0]).toBe(`# sf ${command}`)
    }
  })

  it('lists every command page in the sidebar, so a written page is a reachable one', () => {
    const config = readFileSync(resolve(root, 'docs/.vitepress/config.mts'), 'utf8')
    for (const command of documented()) {
      expect(config).toContain(`/cli/sf-${command}`)
    }
  })
})
