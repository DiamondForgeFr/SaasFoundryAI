jest.mock('../../../feedback/gh', () => ({
  ensureGhAuth: jest.fn(),
  ghIssueSearch: jest.fn(),
  ghIssueCreate: jest.fn(),
  ghIssueComment: jest.fn(),
  ghAddReaction: jest.fn(),
  ghCurrentUser: jest.fn()
}))

jest.mock('../../../feedback/repo', () => ({
  readFeedbackRepo: jest.fn()
}))

import { feedbackCommand } from '../../../commands/feedback'
import { ensureGhAuth, ghAddReaction, ghCurrentUser, ghIssueComment, ghIssueCreate, ghIssueSearch } from '../../../feedback/gh'
import { readFeedbackRepo } from '../../../feedback/repo'
import { readPreferences } from '../../../skill/preferences'
import { createTempDir } from '../../helpers/temp-dir'

const mockEnsureGhAuth = ensureGhAuth as jest.Mock
const mockGhIssueSearch = ghIssueSearch as jest.Mock
const mockGhIssueCreate = ghIssueCreate as jest.Mock
const mockGhIssueComment = ghIssueComment as jest.Mock
const mockGhAddReaction = ghAddReaction as jest.Mock
const mockGhCurrentUser = ghCurrentUser as jest.Mock
const mockReadFeedbackRepo = readFeedbackRepo as jest.Mock

describe('feedbackCommand (integration)', () => {
  let originalHome: string | undefined
  let tempHome: string
  let cleanupHome: () => Promise<void>
  let logSpy: jest.SpyInstance
  let errorSpy: jest.SpyInstance
  let exitSpy: jest.SpyInstance
  let stdoutSpy: jest.SpyInstance
  let isTty: boolean

  beforeEach(async () => {
    originalHome = process.env.HOME
    const { dir, cleanup } = await createTempDir()
    tempHome = dir
    cleanupHome = cleanup
    process.env.HOME = tempHome

    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`)
    }) as never)
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation((() => true) as never)

    isTty = Boolean(process.stdin.isTTY)
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true })

    mockEnsureGhAuth.mockReset().mockResolvedValue(undefined)
    mockGhIssueSearch.mockReset().mockResolvedValue([])
    mockGhIssueCreate.mockReset()
    mockGhIssueComment.mockReset().mockResolvedValue(undefined)
    mockGhAddReaction.mockReset().mockResolvedValue(undefined)
    mockGhCurrentUser.mockReset().mockResolvedValue('octocat')
    mockReadFeedbackRepo.mockReset().mockResolvedValue({
      owner: 'DiamondForgeFr',
      repo: 'SaaSFoundry',
      slug: 'DiamondForgeFr/SaaSFoundry',
      httpsUrl: 'https://github.com/DiamondForgeFr/SaaSFoundry'
    })
  })

  afterEach(async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: isTty, configurable: true })
    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome
    logSpy.mockRestore()
    errorSpy.mockRestore()
    exitSpy.mockRestore()
    stdoutSpy.mockRestore()
    await cleanupHome()
  })

  const allLog = () => logSpy.mock.calls.map((c) => c.join(' ')).join('\n')
  const allStdout = () => stdoutSpy.mock.calls.map((c) => String(c[0])).join('')

  describe('dispatcher', () => {
    it('prints help when no subcommand is given', async () => {
      await feedbackCommand()
      const out = allLog()
      expect(out).toContain('SaaSFoundry Feedback')
      expect(out).toContain('request <name>')
      expect(out).toContain('bug')
      expect(out).toContain('list')
      expect(out).toContain('vote')
    })

    it('exits with an error for unknown subcommands', async () => {
      await expect(feedbackCommand('bogus')).rejects.toThrow(/process\.exit\(1\)/)
      expect(errorSpy.mock.calls.some((c) => c.join(' ').includes('Unknown subcommand'))).toBe(true)
    })

    it('help mentions every documented flag', async () => {
      await feedbackCommand()
      const out = allLog()
      expect(out).toContain('--description')
      expect(out).toContain('--source cli|scaffold')
      expect(out).toContain('--auto-repro')
      expect(out).toContain('--status')
      expect(out).toContain('--mine')
      expect(out).toContain('--json')
      expect(out).toContain('--stack-filter')
    })
  })

  describe('request', () => {
    it('files a new module-request when no dedup matches exist', async () => {
      mockGhIssueSearch.mockResolvedValue([])
      mockGhIssueCreate.mockResolvedValue({
        number: 101,
        url: 'https://github.com/DiamondForgeFr/SaaSFoundry/issues/101',
        title: 'Module request: Stripe',
        state: 'OPEN',
        labels: [{ name: 'module-request' }],
        author: { login: '' }
      })

      await feedbackCommand('request', 'Stripe', '--description', 'Accept payments', '--non-interactive')

      expect(mockGhIssueCreate).toHaveBeenCalledTimes(1)
      const call = mockGhIssueCreate.mock.calls[0][0]
      expect(call.labels).toEqual(['module-request'])
      expect(call.title).toBe('Module request: Stripe')

      const prefs = await readPreferences()
      expect(prefs.filedRequests.map((r) => r.issueNumber)).toContain(101)
      expect(allLog()).toContain('Filed request #101')
    })

    it('skips creation when dedup matches exist (non-interactive)', async () => {
      mockGhIssueSearch.mockResolvedValue([
        { number: 5, title: 'Add Stripe', state: 'OPEN', url: 'https://x/5', labels: [{ name: 'module-request' }], author: { login: 'a' } }
      ])
      await feedbackCommand('request', 'Stripe', '--description', 'd', '--non-interactive')
      expect(mockGhIssueCreate).not.toHaveBeenCalled()
      expect(allLog()).toContain('Similar requests found')
    })

    it('errors when <name> is missing', async () => {
      await expect(feedbackCommand('request', '--non-interactive')).rejects.toThrow(/process\.exit\(1\)/)
      expect(errorSpy.mock.calls.some((c) => c.join(' ').includes('missing <name>'))).toBe(true)
    })

    it('errors in --non-interactive when --description is omitted', async () => {
      mockGhIssueSearch.mockResolvedValue([])
      await expect(feedbackCommand('request', 'Stripe', '--non-interactive')).rejects.toThrow(/process\.exit\(1\)/)
      expect(errorSpy.mock.calls.some((c) => c.join(' ').includes('--description is required'))).toBe(true)
    })
  })

  describe('bug', () => {
    it('files a cli-bug with --source cli', async () => {
      mockGhIssueSearch.mockResolvedValue([])
      mockGhIssueCreate.mockResolvedValue({ number: 7, url: 'https://x/7', title: 'crash', state: 'OPEN', labels: [{ name: 'cli-bug' }], author: { login: '' } })

      await feedbackCommand('bug', '--source', 'cli', '--title', 'crash on new', '--description', 'stack trace', '--non-interactive')

      expect(mockGhIssueCreate).toHaveBeenCalledTimes(1)
      expect(mockGhIssueCreate.mock.calls[0][0].labels).toEqual(['cli-bug'])
    })

    it('files a scaffold-bug with --source scaffold', async () => {
      mockGhIssueSearch.mockResolvedValue([])
      mockGhIssueCreate.mockResolvedValue({ number: 8, url: 'https://x/8', title: 'b', state: 'OPEN', labels: [{ name: 'scaffold-bug' }], author: { login: '' } })

      await feedbackCommand('bug', '--source', 'scaffold', '--title', 'vite build fails', '--description', 'd', '--non-interactive')

      expect(mockGhIssueCreate.mock.calls[0][0].labels).toEqual(['scaffold-bug'])
    })

    it('rejects an invalid --source', async () => {
      await expect(feedbackCommand('bug', '--source', 'hardware', '--title', 't', '--description', 'd', '--non-interactive')).rejects.toThrow(/process\.exit\(1\)/)
      expect(errorSpy.mock.calls.some((c) => c.join(' ').includes("--source must be 'cli' or 'scaffold'"))).toBe(true)
    })

    it('requires --source in --non-interactive mode', async () => {
      await expect(feedbackCommand('bug', '--title', 't', '--description', 'd', '--non-interactive')).rejects.toThrow(/process\.exit\(1\)/)
      expect(errorSpy.mock.calls.some((c) => c.join(' ').includes('--source is required'))).toBe(true)
    })
  })

  describe('list', () => {
    it('queries all three feedback labels and prints them', async () => {
      mockGhIssueSearch
        .mockResolvedValueOnce([{ number: 10, title: 'Req A', state: 'OPEN', url: 'https://x/10', labels: [{ name: 'module-request' }], author: { login: 'a' } }])
        .mockResolvedValueOnce([{ number: 7, title: 'CLI bug', state: 'OPEN', url: 'https://x/7', labels: [{ name: 'cli-bug' }], author: { login: 'b' } }])
        .mockResolvedValueOnce([{ number: 3, title: 'Scaf bug', state: 'OPEN', url: 'https://x/3', labels: [{ name: 'scaffold-bug' }], author: { login: 'c' } }])

      await feedbackCommand('list')

      expect(mockGhIssueSearch).toHaveBeenCalledTimes(3)
      const out = allLog()
      expect(out).toContain('#10')
      expect(out).toContain('#7')
      expect(out).toContain('#3')
    })

    it('emits JSON with --json', async () => {
      mockGhIssueSearch
        .mockResolvedValueOnce([{ number: 10, title: 'Req A', state: 'OPEN', url: 'https://x/10', labels: [{ name: 'module-request' }], author: { login: 'a' } }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])

      await feedbackCommand('list', '--json')
      const json = JSON.parse(allStdout())
      expect(Array.isArray(json)).toBe(true)
      expect(json[0]).toMatchObject({ number: 10, kind: 'module-request', url: 'https://x/10', author: 'a' })
    })

    it('injects the current user when --mine is set', async () => {
      mockGhIssueSearch.mockResolvedValue([])
      await feedbackCommand('list', '--mine')
      expect(mockGhCurrentUser).toHaveBeenCalledTimes(1)
      for (const call of mockGhIssueSearch.mock.calls) {
        expect(call[0].author).toBe('octocat')
      }
    })

    it('rejects an invalid --status', async () => {
      await expect(feedbackCommand('list', '--status', 'sideways')).rejects.toThrow(/process\.exit\(1\)/)
      expect(errorSpy.mock.calls.some((c) => c.join(' ').includes("--status must be 'open', 'closed', or 'all'"))).toBe(true)
    })
  })

  describe('vote', () => {
    it('--list ranks module-request issues by 👍', async () => {
      mockGhIssueSearch.mockResolvedValue([
        {
          number: 1,
          title: 'A',
          state: 'OPEN',
          url: 'https://x/1',
          labels: [{ name: 'module-request' }],
          author: { login: 'a' },
          reactionGroups: [{ content: 'THUMBS_UP', users: { totalCount: 2 } }]
        },
        {
          number: 2,
          title: 'B',
          state: 'OPEN',
          url: 'https://x/2',
          labels: [{ name: 'module-request' }],
          author: { login: 'b' },
          reactionGroups: [{ content: 'THUMBS_UP', users: { totalCount: 9 } }]
        }
      ])

      await feedbackCommand('vote', '--list')
      const out = allLog()
      const idxB = out.indexOf('#2')
      const idxA = out.indexOf('#1')
      expect(idxB).toBeGreaterThan(-1)
      expect(idxA).toBeGreaterThan(-1)
      expect(idxB).toBeLessThan(idxA)
    })

    it('casts a 👍 reaction and records it in prefs', async () => {
      await feedbackCommand('vote', '42', 'up')
      expect(mockGhAddReaction).toHaveBeenCalledWith({ repo: 'DiamondForgeFr/SaaSFoundry', issueNumber: 42, content: '+1' })
      const prefs = await readPreferences()
      expect(prefs.votesCast[0]).toMatchObject({ issueNumber: 42, direction: 'up' })
    })

    it('posts a comment with --comment', async () => {
      await feedbackCommand('vote', '42', 'comment', '--comment', 'I need this for payroll.')
      expect(mockGhIssueComment).toHaveBeenCalledWith('DiamondForgeFr/SaaSFoundry', 42, 'I need this for payroll.')
    })

    it('rejects an invalid issue number', async () => {
      await expect(feedbackCommand('vote', 'banana', 'up')).rejects.toThrow(/process\.exit\(1\)/)
      expect(errorSpy.mock.calls.some((c) => c.join(' ').includes('expected a positive issue number'))).toBe(true)
    })

    it('rejects an invalid action', async () => {
      await expect(feedbackCommand('vote', '1', 'sideways')).rejects.toThrow(/process\.exit\(1\)/)
      expect(errorSpy.mock.calls.some((c) => c.join(' ').includes("action must be 'up', 'down', or 'comment'"))).toBe(true)
    })

    it('requires --comment body for action=comment in --non-interactive mode', async () => {
      await expect(feedbackCommand('vote', '1', 'comment', '--non-interactive')).rejects.toThrow(/process\.exit\(1\)/)
      expect(errorSpy.mock.calls.some((c) => c.join(' ').includes('--comment is required'))).toBe(true)
    })
  })
})
