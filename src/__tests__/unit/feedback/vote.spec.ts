jest.mock('../../../feedback/gh', () => ({
  ensureGhAuth: jest.fn(),
  ghIssueSearch: jest.fn(),
  ghAddReaction: jest.fn(),
  ghIssueComment: jest.fn()
}))

jest.mock('../../../feedback/repo', () => ({
  readFeedbackRepo: jest.fn()
}))

import { ensureGhAuth, ghAddReaction, ghIssueComment, ghIssueSearch } from '../../../feedback/gh'
import { readFeedbackRepo } from '../../../feedback/repo'
import { castVote, countReaction, listVotable } from '../../../feedback/vote'
import { DEFAULT_PREFERENCES, readPreferences, writePreferences } from '../../../skill/preferences'
import { createTempDir } from '../../helpers/temp-dir'

const mockEnsureGhAuth = ensureGhAuth as jest.Mock
const mockGhIssueSearch = ghIssueSearch as jest.Mock
const mockGhAddReaction = ghAddReaction as jest.Mock
const mockGhIssueComment = ghIssueComment as jest.Mock
const mockReadFeedbackRepo = readFeedbackRepo as jest.Mock

function issue(number: number, thumbsUp: number, thumbsDown = 0) {
  return {
    number,
    title: `Issue ${number}`,
    state: 'OPEN' as const,
    url: `https://x/${number}`,
    labels: [{ name: 'module-request' }],
    author: { login: 'a' },
    reactionGroups: [
      { content: 'THUMBS_UP', users: { totalCount: thumbsUp } },
      { content: 'THUMBS_DOWN', users: { totalCount: thumbsDown } }
    ]
  }
}

describe('feedback/vote', () => {
  let originalHome: string | undefined
  let tempHome: string
  let cleanupHome: () => Promise<void>

  beforeEach(async () => {
    originalHome = process.env.HOME
    const { dir, cleanup } = await createTempDir()
    tempHome = dir
    cleanupHome = cleanup
    process.env.HOME = tempHome

    mockEnsureGhAuth.mockReset()
    mockGhIssueSearch.mockReset()
    mockGhAddReaction.mockReset()
    mockGhIssueComment.mockReset()
    mockReadFeedbackRepo.mockReset()

    mockEnsureGhAuth.mockResolvedValue(undefined)
    mockReadFeedbackRepo.mockResolvedValue({
      owner: 'DiamondForgeFr',
      repo: 'SaaSFoundry',
      slug: 'DiamondForgeFr/SaaSFoundry',
      httpsUrl: 'https://github.com/DiamondForgeFr/SaaSFoundry'
    })
  })

  afterEach(async () => {
    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome
    await cleanupHome()
  })

  describe('countReaction', () => {
    it('returns 0 when reactionGroups is missing', () => {
      const i = { number: 1, title: 't', state: 'OPEN' as const, url: 'u', labels: [], author: { login: 'a' } }
      expect(countReaction(i, 'THUMBS_UP')).toBe(0)
    })

    it('returns the totalCount for the matching group', () => {
      expect(countReaction(issue(1, 5, 2), 'THUMBS_UP')).toBe(5)
      expect(countReaction(issue(1, 5, 2), 'THUMBS_DOWN')).toBe(2)
    })
  })

  describe('listVotable', () => {
    it('searches open module-request issues and ranks by 👍 desc', async () => {
      mockGhIssueSearch.mockResolvedValue([issue(1, 3), issue(2, 10), issue(3, 7), issue(4, 0)])
      const result = await listVotable({})
      expect(result.issues.map((r) => r.issue.number)).toEqual([2, 3, 1, 4])
      expect(result.issues[0].thumbsUp).toBe(10)

      const call = mockGhIssueSearch.mock.calls[0][0]
      expect(call.labels).toEqual(['module-request'])
      expect(call.state).toBe('open')
    })

    it('caps at the requested limit (default 10)', async () => {
      const many = Array.from({ length: 15 }, (_, i) => issue(i + 1, 15 - i))
      mockGhIssueSearch.mockResolvedValue(many)
      const result = await listVotable({})
      expect(result.issues).toHaveLength(10)
    })

    it('forwards --stack-filter as the search term', async () => {
      mockGhIssueSearch.mockResolvedValue([])
      await listVotable({ stackFilter: 'stripe' })
      expect(mockGhIssueSearch.mock.calls[0][0].search).toBe('stripe')
    })

    it('breaks ties by issue number ascending', async () => {
      mockGhIssueSearch.mockResolvedValue([issue(10, 5), issue(5, 5), issue(7, 5)])
      const result = await listVotable({})
      expect(result.issues.map((r) => r.issue.number)).toEqual([5, 7, 10])
    })
  })

  describe('castVote', () => {
    it('adds a +1 reaction for up and records in votesCast', async () => {
      const result = await castVote({ issueNumber: 42, action: 'up' })
      expect(mockGhAddReaction).toHaveBeenCalledWith({ repo: 'DiamondForgeFr/SaaSFoundry', issueNumber: 42, content: '+1' })
      expect(result.action).toBe('up')

      const prefs = await readPreferences()
      expect(prefs.votesCast).toHaveLength(1)
      expect(prefs.votesCast[0].issueNumber).toBe(42)
      expect(prefs.votesCast[0].direction).toBe('up')
    })

    it('adds a -1 reaction for down and records direction=down', async () => {
      await castVote({ issueNumber: 77, action: 'down' })
      expect(mockGhAddReaction).toHaveBeenCalledWith({ repo: 'DiamondForgeFr/SaaSFoundry', issueNumber: 77, content: '-1' })
      const prefs = await readPreferences()
      expect(prefs.votesCast[0].direction).toBe('down')
    })

    it('posts a comment for action=comment and does NOT touch votesCast', async () => {
      await castVote({ issueNumber: 5, action: 'comment', comment: 'I need this for payroll.' })
      expect(mockGhIssueComment).toHaveBeenCalledWith('DiamondForgeFr/SaaSFoundry', 5, 'I need this for payroll.')
      expect(mockGhAddReaction).not.toHaveBeenCalled()
      const prefs = await readPreferences()
      expect(prefs.votesCast).toHaveLength(0)
    })

    it('rejects an empty comment body', async () => {
      await expect(castVote({ issueNumber: 5, action: 'comment', comment: '   ' })).rejects.toThrow(/empty/)
    })

    it('appends rather than overwriting existing votesCast', async () => {
      await writePreferences({
        ...DEFAULT_PREFERENCES,
        votesCast: [{ issueNumber: 1, direction: 'up', castAt: '2026-04-16T00:00:00.000Z' }]
      })
      await castVote({ issueNumber: 2, action: 'up' })
      const prefs = await readPreferences()
      expect(prefs.votesCast.map((v) => v.issueNumber)).toEqual([1, 2])
    })
  })
})
