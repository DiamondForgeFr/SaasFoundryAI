import { srsCommand } from '../../../commands/srs'
import * as writeSrs from '../../../srs/bin/write-srs'

/**
 * #877 — through the real parsers: an option an action does not know is refused with the
 * documented "bad input" code, and the action never runs. (`srs.spec.ts` mocks every
 * parser, which is how `write --dry-run` writing a duplicate tree went unseen.)
 */
describe('sf srs with an option the action does not know', () => {
  const stderr: string[] = []

  beforeEach(() => {
    stderr.length = 0
    process.exitCode = undefined
    jest.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr.push(String(chunk))
      return true
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
    process.exitCode = undefined
  })

  it('refuses `write --dry-run` with exit 2, before writing anything', async () => {
    const run = jest.spyOn(writeSrs, 'runWriteSrs')

    await srsCommand('write', '--spec', 'spec.json', '--dry-run')

    expect(process.exitCode).toBe(2)
    expect(run).not.toHaveBeenCalled()
    expect(stderr.join('')).toContain("sf srs write: write-srs: unknown option '--dry-run'")
    expect(stderr.join('')).not.toContain('unexpected error')
  })

  it('reports a missing required option as bad input, not as an unexpected error', async () => {
    await srsCommand('spawn', '--version', 'v0')

    expect(process.exitCode).toBe(2)
    expect(stderr.join('')).toContain('spawn: missing --epic')
    expect(stderr.join('')).not.toContain('unexpected error')
  })
})
