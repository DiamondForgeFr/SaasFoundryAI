import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * #622 — a server that never came up read as a browser that would not open.
 *
 * Both outcomes landed in one `catch` printing "Could not open browser automatically", so
 * the day the apps failed to start, the screen reported a cosmetic nuisance and then listed
 * four dead URLs.
 *
 * Running the real command needs Docker and a booting project, so these assert the contract
 * on the source — the same approach as new-exit-code.spec.ts, and for the same reason.
 */

const source = readFileSync(resolve(__dirname, '../../../commands/new.ts'), 'utf8')

/**
 * Comments stripped: the assertion below is about what the command prints, and a sentence
 * quoted in a comment explaining why it was removed is not a sentence the user ever sees.
 */
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

describe('a dead server and a stubborn browser are different events (#622)', () => {
  it('never reuses the browser sentence for a server that did not answer', () => {
    // The exact string that made a total boot failure look cosmetic.
    expect(code).not.toContain('Could not open browser automatically')
  })

  it('says plainly that the app is not running when the wait times out', () => {
    expect(code).toContain('never answered on')
    expect(code).toContain('it is not running')
  })

  it('only asks the browser to open a page once something is serving it', () => {
    // `apiUp` / `webUp` gate the open, so a dead port is never handed to `open`.
    const apiBlock = source.slice(source.indexOf('Waiting for backend to be ready'), source.indexOf('3. Open frontend last'))
    expect(apiBlock).toContain('if (apiUp)')
    expect(apiBlock.indexOf('apiUp = true')).toBeLessThan(apiBlock.indexOf('if (apiUp)'))
  })

  it('feeds the observation to the summary instead of rebuilding it from the answers', () => {
    const call = source.slice(source.indexOf('const urlLines = projectUrlLines({'), source.indexOf('const column = labelColumn'))
    expect(call).toContain('apps:')
    expect(call).toContain('apiUp')
    expect(call).toContain('webUp')
    expect(call).toContain('requested: appsRequested')
  })

  it('dims a URL it knows is dead rather than printing it like a live one', () => {
    const render = source.slice(source.indexOf('const column = labelColumn'), source.indexOf('const column = labelColumn') + 900)
    expect(render).toContain('line.unreachable')
  })
})
