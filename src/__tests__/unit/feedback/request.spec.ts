jest.mock('../../../feedback/gh', () => ({
  ensureGhAuth: jest.fn(),
  ghIssueSearch: jest.fn(),
  ghIssueCreate: jest.fn()
}))

jest.mock('../../../feedback/repo', () => ({
  readFeedbackRepo: jest.fn()
}))

import { ensureGhAuth, ghIssueCreate, ghIssueSearch } from '../../../feedback/gh'
import { readFeedbackRepo } from '../../../feedback/repo'
import { fileRequest, formatRequestBody, formatRequestTitle, searchExistingRequests } from '../../../feedback/request'
import { DEFAULT_PREFERENCES, readPreferences, writePreferences } from '../../../skill/preferences'
import { createTempDir } from '../../helpers/temp-dir'

const mockEnsureGhAuth = ensureGhAuth as jest.Mock
const mockGhIssueSearch = ghIssueSearch as jest.Mock
const mockGhIssueCreate = ghIssueCreate as jest.Mock
const mockReadFeedbackRepo = readFeedbackRepo as jest.Mock

describe('feedback/request', () => {
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
    mockGhIssueCreate.mockReset()
    mockReadFeedbackRepo.mockReset()

    mockEnsureGhAuth.mockResolvedValue(undefined)
    mockReadFeedbackRepo.mockResolvedValue({
      owner: 'DiamondForgeFr',
      repo: 'SaasFoundryAI',
      slug: 'DiamondForgeFr/SaasFoundryAI',
      httpsUrl: 'https://github.com/DiamondForgeFr/SaasFoundryAI'
    })
  })

  afterEach(async () => {
    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome
    await cleanupHome()
  })

  describe('formatRequestTitle', () => {
    it('prefixes the trimmed name', () => {
      expect(formatRequestTitle('  Stripe  ')).toBe('Module request: Stripe')
    })
  })

  describe('formatRequestBody', () => {
    it('includes description, CLI version, and platform metadata', () => {
      const body = formatRequestBody({ name: 'Stripe', description: 'Accept payments', cliVersion: '1.0.0-beta' })
      expect(body).toContain('Accept payments')
      expect(body).toContain('**CLI version:** 1.0.0-beta')
      expect(body).toContain(`**Platform:** ${process.platform}`)
      expect(body).toContain(`**Node:** ${process.version}`)
    })

    it('falls back to a placeholder when description is blank', () => {
      const body = formatRequestBody({ name: 'Stripe', description: '   ', cliVersion: '1.0.0-beta' })
      expect(body).toContain('_(no description provided)_')
    })
  })

  describe('searchExistingRequests', () => {
    it('ensures gh auth and searches with module-request label', async () => {
      mockGhIssueSearch.mockResolvedValue([])
      const result = await searchExistingRequests('Stripe')
      expect(mockEnsureGhAuth).toHaveBeenCalled()
      expect(mockGhIssueSearch).toHaveBeenCalledWith({
        repo: 'DiamondForgeFr/SaasFoundryAI',
        labels: ['module-request'],
        state: 'all',
        search: 'Stripe',
        limit: 10
      })
      expect(result.repo.slug).toBe('DiamondForgeFr/SaasFoundryAI')
      expect(result.matches).toEqual([])
    })

    it('returns matches when gh finds similar issues', async () => {
      mockGhIssueSearch.mockResolvedValue([{ number: 10, title: 'Add Stripe', state: 'OPEN', url: 'https://x', labels: [], author: { login: 'a' } }])
      const result = await searchExistingRequests('Stripe')
      expect(result.matches).toHaveLength(1)
      expect(result.matches[0].number).toBe(10)
    })
  })

  describe('fileRequest', () => {
    it('creates an issue with the module-request label and records it in preferences', async () => {
      mockGhIssueCreate.mockResolvedValue({
        number: 42,
        url: 'https://github.com/DiamondForgeFr/SaasFoundryAI/issues/42',
        title: 'Module request: Stripe',
        state: 'OPEN',
        labels: [{ name: 'module-request' }],
        author: { login: '' }
      })

      const result = await fileRequest({ name: 'Stripe', description: 'Accept payments', cliVersion: '1.0.0-beta' })

      expect(mockGhIssueCreate).toHaveBeenCalledTimes(1)
      const call = mockGhIssueCreate.mock.calls[0][0]
      expect(call.repo).toBe('DiamondForgeFr/SaasFoundryAI')
      expect(call.title).toBe('Module request: Stripe')
      expect(call.labels).toEqual(['module-request'])
      expect(call.body).toContain('Accept payments')

      expect(result.issue.number).toBe(42)

      const prefs = await readPreferences()
      expect(prefs.filedRequests).toHaveLength(1)
      expect(prefs.filedRequests[0]).toMatchObject({
        issueNumber: 42,
        repoUrl: 'https://github.com/DiamondForgeFr/SaasFoundryAI/issues/42',
        title: 'Module request: Stripe'
      })
      expect(typeof prefs.filedRequests[0].openedAt).toBe('string')
    })

    it('appends rather than overwriting existing filedRequests', async () => {
      await writePreferences({
        ...DEFAULT_PREFERENCES,
        filedRequests: [{ issueNumber: 1, repoUrl: 'u1', title: 'First', openedAt: '2026-04-16T00:00:00.000Z' }]
      })

      mockGhIssueCreate.mockResolvedValue({
        number: 99,
        url: 'https://x/99',
        title: 'Module request: Second',
        state: 'OPEN',
        labels: [{ name: 'module-request' }],
        author: { login: '' }
      })

      await fileRequest({ name: 'Second', description: 'd', cliVersion: '1.0.0' })

      const prefs = await readPreferences()
      expect(prefs.filedRequests).toHaveLength(2)
      expect(prefs.filedRequests[0].issueNumber).toBe(1)
      expect(prefs.filedRequests[1].issueNumber).toBe(99)
    })
  })
})
