jest.mock('../../../feedback/gh', () => ({
  ensureGhAuth: jest.fn(),
  ghIssueSearch: jest.fn(),
  ghCurrentUser: jest.fn()
}))

jest.mock('../../../feedback/repo', () => ({
  readFeedbackRepo: jest.fn()
}))

import { ensureGhAuth, ghCurrentUser, ghIssueSearch } from '../../../feedback/gh'
import { readFeedbackRepo } from '../../../feedback/repo'
import { classifyIssue, FEEDBACK_LABELS, listFeedback } from '../../../feedback/list'

const mockEnsureGhAuth = ensureGhAuth as jest.Mock
const mockGhIssueSearch = ghIssueSearch as jest.Mock
const mockGhCurrentUser = ghCurrentUser as jest.Mock
const mockReadFeedbackRepo = readFeedbackRepo as jest.Mock

function issue(number: number, labelName: string, state: 'OPEN' | 'CLOSED' = 'OPEN', login = 'alice') {
  return {
    number,
    title: `Issue #${number}`,
    state,
    url: `https://x/${number}`,
    labels: [{ name: labelName }],
    author: { login }
  }
}

describe('feedback/list', () => {
  beforeEach(() => {
    mockEnsureGhAuth.mockReset()
    mockGhIssueSearch.mockReset()
    mockGhCurrentUser.mockReset()
    mockReadFeedbackRepo.mockReset()

    mockEnsureGhAuth.mockResolvedValue(undefined)
    mockReadFeedbackRepo.mockResolvedValue({
      owner: 'DiamondForgeFr',
      repo: 'SaasFoundryAI',
      slug: 'DiamondForgeFr/SaasFoundryAI',
      httpsUrl: 'https://github.com/DiamondForgeFr/SaasFoundryAI'
    })
  })

  describe('classifyIssue', () => {
    it('picks module-request, cli-bug, scaffold-bug, or other', () => {
      expect(classifyIssue(issue(1, 'module-request'))).toBe('module-request')
      expect(classifyIssue(issue(1, 'cli-bug'))).toBe('cli-bug')
      expect(classifyIssue(issue(1, 'scaffold-bug'))).toBe('scaffold-bug')
      expect(classifyIssue(issue(1, 'something-else'))).toBe('other')
    })
  })

  describe('listFeedback', () => {
    it('queries each feedback label and merges results sorted by number desc', async () => {
      mockGhIssueSearch
        .mockResolvedValueOnce([issue(10, 'module-request'), issue(5, 'module-request')])
        .mockResolvedValueOnce([issue(7, 'cli-bug')])
        .mockResolvedValueOnce([issue(3, 'scaffold-bug')])

      const result = await listFeedback({})
      expect(result.issues.map((i) => i.number)).toEqual([10, 7, 5, 3])
      expect(mockGhIssueSearch).toHaveBeenCalledTimes(FEEDBACK_LABELS.length)
      expect(mockEnsureGhAuth).toHaveBeenCalled()
    })

    it('defaults to state=open', async () => {
      mockGhIssueSearch.mockResolvedValue([])
      await listFeedback({})
      for (const call of mockGhIssueSearch.mock.calls) {
        expect(call[0].state).toBe('open')
      }
    })

    it('honors --status=all', async () => {
      mockGhIssueSearch.mockResolvedValue([])
      await listFeedback({ status: 'all' })
      for (const call of mockGhIssueSearch.mock.calls) {
        expect(call[0].state).toBe('all')
      }
    })

    it('passes current user as author when --mine is set', async () => {
      mockGhCurrentUser.mockResolvedValue('octocat')
      mockGhIssueSearch.mockResolvedValue([])
      await listFeedback({ mine: true })
      expect(mockGhCurrentUser).toHaveBeenCalledTimes(1)
      for (const call of mockGhIssueSearch.mock.calls) {
        expect(call[0].author).toBe('octocat')
      }
    })

    it('does not set author when --mine is false', async () => {
      mockGhIssueSearch.mockResolvedValue([])
      await listFeedback({})
      expect(mockGhCurrentUser).not.toHaveBeenCalled()
      for (const call of mockGhIssueSearch.mock.calls) {
        expect(call[0].author).toBeUndefined()
      }
    })

    it('deduplicates when the same issue carries two feedback labels', async () => {
      mockGhIssueSearch
        .mockResolvedValueOnce([issue(42, 'module-request')])
        .mockResolvedValueOnce([issue(42, 'cli-bug')])
        .mockResolvedValueOnce([])

      const result = await listFeedback({})
      expect(result.issues).toHaveLength(1)
      expect(result.issues[0].number).toBe(42)
    })

    it('respects the final limit after merging', async () => {
      mockGhIssueSearch
        .mockResolvedValueOnce([issue(10, 'module-request'), issue(9, 'module-request'), issue(8, 'module-request')])
        .mockResolvedValueOnce([issue(7, 'cli-bug'), issue(6, 'cli-bug')])
        .mockResolvedValueOnce([issue(5, 'scaffold-bug')])

      const result = await listFeedback({ limit: 3 })
      expect(result.issues).toHaveLength(3)
      expect(result.issues.map((i) => i.number)).toEqual([10, 9, 8])
    })
  })
})
