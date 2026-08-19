jest.mock('../../../feedback/gh', () => ({
  ensureGhAuth: jest.fn(),
  ghIssueSearch: jest.fn(),
  ghIssueCreate: jest.fn()
}))

jest.mock('../../../feedback/repo', () => ({
  readFeedbackRepo: jest.fn()
}))

import { writeFile } from 'fs/promises'
import path from 'path'

import { bugLabel, collectReproContext, fileBug, formatBugBody, searchExistingBugs } from '../../../feedback/bug'
import { ensureGhAuth, ghIssueCreate, ghIssueSearch } from '../../../feedback/gh'
import { readFeedbackRepo } from '../../../feedback/repo'
import { createTempDir } from '../../helpers/temp-dir'

const mockEnsureGhAuth = ensureGhAuth as jest.Mock
const mockGhIssueSearch = ghIssueSearch as jest.Mock
const mockGhIssueCreate = ghIssueCreate as jest.Mock
const mockReadFeedbackRepo = readFeedbackRepo as jest.Mock

describe('feedback/bug', () => {
  beforeEach(() => {
    mockEnsureGhAuth.mockReset()
    mockGhIssueSearch.mockReset()
    mockGhIssueCreate.mockReset()
    mockReadFeedbackRepo.mockReset()

    mockEnsureGhAuth.mockResolvedValue(undefined)
    mockReadFeedbackRepo.mockResolvedValue({
      owner: 'DiamondForgeFr',
      repo: 'SaaSFoundryAI',
      slug: 'DiamondForgeFr/SaaSFoundryAI',
      httpsUrl: 'https://github.com/DiamondForgeFr/SaaSFoundryAI'
    })
  })

  describe('bugLabel', () => {
    it('maps cli to cli-bug and scaffold to scaffold-bug', () => {
      expect(bugLabel('cli')).toBe('cli-bug')
      expect(bugLabel('scaffold')).toBe('scaffold-bug')
    })
  })

  describe('searchExistingBugs', () => {
    it('filters by cli-bug label for cli source', async () => {
      mockGhIssueSearch.mockResolvedValue([])
      await searchExistingBugs('cli', 'crash on new')
      expect(mockGhIssueSearch).toHaveBeenCalledWith({
        repo: 'DiamondForgeFr/SaaSFoundryAI',
        labels: ['cli-bug'],
        state: 'all',
        search: 'crash on new',
        limit: 10
      })
    })

    it('filters by scaffold-bug label for scaffold source', async () => {
      mockGhIssueSearch.mockResolvedValue([])
      await searchExistingBugs('scaffold', 'nestjs build fails')
      expect(mockGhIssueSearch).toHaveBeenCalledWith({
        repo: 'DiamondForgeFr/SaaSFoundryAI',
        labels: ['scaffold-bug'],
        state: 'all',
        search: 'nestjs build fails',
        limit: 10
      })
    })
  })

  describe('collectReproContext', () => {
    it('returns CLI version, Node version, platform, arch', async () => {
      const { dir, cleanup } = await createTempDir()
      try {
        const ctx = await collectReproContext('1.0.0-beta', dir)
        expect(ctx.cliVersion).toBe('1.0.0-beta')
        expect(ctx.nodeVersion).toBe(process.version)
        expect(ctx.platform).toBe(process.platform)
        expect(ctx.arch).toBe(process.arch)
        expect(ctx.saasfoundryJson).toBeNull()
      } finally {
        await cleanup()
      }
    })

    it('reads .saasfoundry.json from cwd when present', async () => {
      const { dir, cleanup } = await createTempDir()
      try {
        const json = JSON.stringify({ workflow: { workingBranch: 'develop' } }, null, 2)
        await writeFile(path.join(dir, '.saasfoundry.json'), json, 'utf8')
        const ctx = await collectReproContext('1.0.0-beta', dir)
        expect(ctx.saasfoundryJson).toBe(json)
      } finally {
        await cleanup()
      }
    })
  })

  describe('formatBugBody', () => {
    it('omits repro section when includeRepro is false', () => {
      const body = formatBugBody({ title: 't', description: 'crash', source: 'cli', cliVersion: '1.0.0', includeRepro: false }, null)
      expect(body).toContain('**Source:** cli')
      expect(body).toContain('**CLI version:** 1.0.0')
      expect(body).not.toContain('**Node:**')
    })

    it('includes repro metadata and .saasfoundry.json block when available', () => {
      const body = formatBugBody(
        { title: 't', description: 'crash', source: 'scaffold', cliVersion: '1.0.0', includeRepro: true },
        {
          cliVersion: '1.0.0',
          nodeVersion: 'v22.0.0',
          platform: 'darwin',
          arch: 'arm64',
          saasfoundryJson: '{"workflow":{"workingBranch":"develop"}}'
        }
      )
      expect(body).toContain('**Source:** scaffold')
      expect(body).toContain('**Node:** v22.0.0')
      expect(body).toContain('**Platform:** darwin (arm64)')
      expect(body).toContain('.saasfoundry.json')
      expect(body).toContain('"workingBranch":"develop"')
    })

    it('notes missing .saasfoundry.json in repro mode', () => {
      const body = formatBugBody(
        { title: 't', description: 'crash', source: 'cli', cliVersion: '1.0.0', includeRepro: true },
        { cliVersion: '1.0.0', nodeVersion: 'v22', platform: 'linux', arch: 'x64', saasfoundryJson: null }
      )
      expect(body).toContain('_(no .saasfoundry.json found in cwd)_')
    })
  })

  describe('fileBug', () => {
    it('creates an issue with the cli-bug label for source=cli', async () => {
      mockGhIssueCreate.mockResolvedValue({ number: 7, url: 'https://x/7', title: 't', state: 'OPEN', labels: [], author: { login: '' } })
      await fileBug({ title: 'crash', description: 'd', source: 'cli', cliVersion: '1.0.0', includeRepro: false })
      const call = mockGhIssueCreate.mock.calls[0][0]
      expect(call.labels).toEqual(['cli-bug'])
    })

    it('creates an issue with the scaffold-bug label for source=scaffold', async () => {
      mockGhIssueCreate.mockResolvedValue({ number: 8, url: 'https://x/8', title: 't', state: 'OPEN', labels: [], author: { login: '' } })
      await fileBug({ title: 'build fails', description: 'd', source: 'scaffold', cliVersion: '1.0.0', includeRepro: false })
      const call = mockGhIssueCreate.mock.calls[0][0]
      expect(call.labels).toEqual(['scaffold-bug'])
    })

    it('includes repro metadata in the body when includeRepro is true', async () => {
      const { dir, cleanup } = await createTempDir()
      try {
        mockGhIssueCreate.mockResolvedValue({ number: 9, url: 'https://x/9', title: 't', state: 'OPEN', labels: [], author: { login: '' } })
        await fileBug({ title: 'oops', description: 'd', source: 'cli', cliVersion: '1.0.0', includeRepro: true, cwd: dir })
        const call = mockGhIssueCreate.mock.calls[0][0]
        expect(call.body).toContain(`**Node:** ${process.version}`)
        expect(call.body).toContain(`**Platform:** ${process.platform}`)
      } finally {
        await cleanup()
      }
    })
  })
})
