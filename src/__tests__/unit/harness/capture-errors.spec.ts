import { appendFile, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { appendCaptureError, CAPTURE_ERRORS_FILE, captureErrorWindowStart, readCaptureErrors, sanitizeCaptureMessage } from '../../../harness/capture-errors'

const DAY = 86_400_000
const NOW = new Date('2026-11-07T10:00:00.000Z')
const at = (daysAgo: number) => () => new Date(NOW.getTime() - daysAgo * DAY)

describe('the capture error log (#1105)', () => {
  let dir: string
  const file = () => join(dir, CAPTURE_ERRORS_FILE)
  const lines = async () =>
    (await readFile(file(), 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  const error = (message: string, stage: 'payload' | 'ledger' | 'adjustment' | 'ignored' = 'ledger') => ({ host: 'claude-code', event: 'SubagentStop', stage, message })

  beforeEach(async () => {
    dir = join(await realpath(await mkdtemp(join(tmpdir(), 'sf-capture-errors-'))), 'saasfoundry')
  })
  afterEach(async () => rm(join(dir, '..'), { recursive: true, force: true }))

  describe('appending', () => {
    it('writes one versioned line per failure, in the clone-private directory it creates, readable only by its owner', async () => {
      expect(await appendCaptureError(dir, error('the ledger is locked'), at(0))).toBe(true)
      expect(await appendCaptureError(dir, error('a second failure', 'adjustment'), at(0))).toBe(true)
      expect(await lines()).toEqual([
        { v: 1, at: NOW.toISOString(), host: 'claude-code', event: 'SubagentStop', stage: 'ledger', message: 'the ledger is locked' },
        { v: 1, at: NOW.toISOString(), host: 'claude-code', event: 'SubagentStop', stage: 'adjustment', message: 'a second failure' }
      ])
      expect((await stat(file())).mode & 0o777).toBe(0o600)
    })

    it('never throws, whatever is wrong with the place it writes to', async () => {
      // The parent of the directory is a file: nothing can be created under it.
      await mkdir(join(dir, '..'), { recursive: true })
      await writeFile(join(dir, '..', 'blocker'), 'x')
      await expect(appendCaptureError(join(dir, '..', 'blocker', 'saasfoundry'), error('boom'))).resolves.toBe(false)
      await expect(appendCaptureError(dir, { host: undefined, event: undefined, stage: undefined, message: undefined } as never)).resolves.toBe(true)
    })

    it('refuses to write through a link', async () => {
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'elsewhere'), 'untouched')
      await symlink(join(dir, 'elsewhere'), file())
      expect(await appendCaptureError(dir, error('through a link'))).toBe(false)
      expect(await readFile(join(dir, 'elsewhere'), 'utf8')).toBe('untouched')
    })

    it('keeps a stage, a host and an event it does not know out of the log as plain words', async () => {
      await appendCaptureError(dir, { host: 'codex\nx', event: 'Sub agent stop {"a":1}', stage: 'surprise' as never, message: 'm' })
      expect(await lines()).toEqual([expect.objectContaining({ host: 'unknown', event: 'unknown', stage: 'payload' })])
    })

    it('bounds the file: past 64 KiB it keeps the last 200 lines, newest last, and leaves no temporary file', async () => {
      const long = 'x'.repeat(280)
      for (let index = 0; index < 400; index++) await appendCaptureError(dir, error(`${index} ${long}`), at(0))
      const kept = await lines()
      expect(kept.length).toBeLessThanOrEqual(200)
      expect(kept.length).toBeGreaterThan(50)
      expect(kept[kept.length - 1].message.startsWith('399 ')).toBe(true)
      expect((await stat(file())).size).toBeLessThan(64 * 1024 + 1024)
      expect((await readdir(dir)).filter((name) => name.endsWith('.tmp') || name.endsWith('.lock'))).toEqual([])
    })
  })

  describe('what a message may hold', () => {
    it('is one line of plain text, bounded to about 300 characters', () => {
      expect(sanitizeCaptureMessage('first\nsecond\r\n\tthird\u001b[31m')).toBe('first second third [31m')
      const cut = sanitizeCaptureMessage('y'.repeat(2_000))
      expect(cut.length).toBe(300)
      expect(cut.endsWith('…')).toBe(true)
    })

    it('hides an agent id and any long hexadecimal token', () => {
      const message = sanitizeCaptureMessage('agent 01a15f3c-94fb-7981-94c0-8583d7bca7f6 and a1b2c3d4e5f60718293a4b5c6d7e8f90 failed')
      expect(message).toBe('agent <id> and <id> failed')
    })

    it('does not carry a payload through the stored line', async () => {
      await appendCaptureError(dir, error('capture failed: agent 01a15f3c-94fb-7981-94c0-8583d7bca7f6\nlast_assistant_message: secret'))
      const [entry] = await lines()
      expect(entry.message).not.toContain('01a15f3c')
      expect(entry.message).not.toContain('\n')
    })
  })

  describe('reading', () => {
    it('counts the failures of the window and names the last one', async () => {
      await appendCaptureError(dir, error('old', 'payload'), at(9))
      await appendCaptureError(dir, error('inside', 'ledger'), at(6))
      await appendCaptureError(dir, error('latest', 'adjustment'), at(1))
      const summary = await readCaptureErrors(dir, { since: captureErrorWindowStart(NOW) })
      expect(summary.count).toBe(2)
      expect(summary.since).toBe('2026-10-31T10:00:00.000Z')
      expect(summary.last).toEqual({ at: at(1)().toISOString(), host: 'claude-code', event: 'SubagentStop', stage: 'adjustment', message: 'latest' })
    })

    it('holds nothing when there is no log, or when the window is empty', async () => {
      expect(await readCaptureErrors(dir, { since: captureErrorWindowStart(NOW) })).toEqual({ count: 0, since: '2026-10-31T10:00:00.000Z' })
      await appendCaptureError(dir, error('old'), at(30))
      expect(await readCaptureErrors(dir, { since: captureErrorWindowStart(NOW) })).toEqual({ count: 0, since: '2026-10-31T10:00:00.000Z' })
    })

    it('skips a torn, foreign or invalid line without losing the others', async () => {
      await mkdir(dir, { recursive: true })
      await writeFile(
        file(),
        [
          '{"v":1,"at":"2026-11-06T10:00:00.000Z","host":"codex","event":"SubagentStop","stage":"payload","message":"kept"}',
          '{torn',
          '[]',
          '{"v":2,"at":"2026-11-06T10:00:00.000Z","host":"codex","event":"x","stage":"payload","message":"future format"}',
          '{"v":1,"at":"yesterday","host":"codex","event":"x","stage":"payload","message":"bad date"}',
          '{"v":1,"at":"2026-11-06T11:00:00.000Z","host":"codex","event":"x","stage":"elsewhere","message":"unknown stage"}',
          ''
        ].join('\n')
      )
      const summary = await readCaptureErrors(dir, { since: captureErrorWindowStart(NOW) })
      expect(summary.count).toBe(1)
      expect(summary.last?.message).toBe('kept')
    })

    it('reads only the tail of a file that grew past what a read should cost', async () => {
      await mkdir(dir, { recursive: true })
      const entry = (index: number) =>
        `${JSON.stringify({ v: 1, at: '2026-11-06T10:00:00.000Z', host: 'codex', event: 'SubagentStop', stage: 'ledger', message: `entry ${index} ${'z'.repeat(200)}` })}\n`
      await writeFile(file(), '')
      for (let chunk = 0; chunk < 10; chunk++) await appendFile(file(), Array.from({ length: 200 }, (_, index) => entry(chunk * 200 + index)).join(''))
      expect((await stat(file())).size).toBeGreaterThan(256 * 1024)
      const summary = await readCaptureErrors(dir, { since: captureErrorWindowStart(NOW) })
      expect(summary.count).toBeGreaterThan(0)
      expect(summary.count).toBeLessThan(2_000)
      expect(summary.last?.message.startsWith('entry 1999 ')).toBe(true)
    })

    it('reports nothing, and does not throw, for a log that is a link or a directory', async () => {
      await mkdir(dir, { recursive: true })
      await mkdir(file())
      expect(await readCaptureErrors(dir, { since: captureErrorWindowStart(NOW) })).toEqual({ count: 0, since: '2026-10-31T10:00:00.000Z' })
    })
  })
})
