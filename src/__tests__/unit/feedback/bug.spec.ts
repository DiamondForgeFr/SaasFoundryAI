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

import { GITHUB_ISSUE_BODY_LIMIT, IssueBodyTooLargeError, countCharacters } from '../../../feedback/body-limit'
import { bugLabel, collectReproContext, fileBug, formatBugBody, searchExistingBugs } from '../../../feedback/bug'
import { ensureGhAuth, ghIssueCreate, ghIssueSearch } from '../../../feedback/gh'
import { readFeedbackRepo } from '../../../feedback/repo'
import { fullManifestFixture } from '../../helpers/full-manifest'
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
      repo: 'SaasFoundryAI',
      slug: 'DiamondForgeFr/SaasFoundryAI',
      httpsUrl: 'https://github.com/DiamondForgeFr/SaasFoundryAI'
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
        repo: 'DiamondForgeFr/SaasFoundryAI',
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
        repo: 'DiamondForgeFr/SaasFoundryAI',
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
        expect(ctx.manifest).toEqual({ status: 'absent' })
      } finally {
        await cleanup()
      }
    })

    it('summarizes .saasfoundry.json from cwd when present, instead of carrying the file', async () => {
      const { dir, cleanup } = await createTempDir()
      try {
        const json = JSON.stringify({ version: '1.0.1', structure: 'monorepo', projectName: 'p', workflow: { workingBranch: 'develop' }, fileHashes: { 'a.ts': 'f'.repeat(64) } }, null, 2)
        await writeFile(path.join(dir, '.saasfoundry.json'), json, 'utf8')
        const ctx = await collectReproContext('1.0.0-beta', dir)
        expect(ctx.manifest.status).toBe('summarized')
        expect(ctx.manifest).toMatchObject({ rawLength: json.length, summary: { structure: 'monorepo', workflow: { workingBranch: 'develop' }, fileHashes: { count: 1 } } })
        expect(JSON.stringify(ctx.manifest)).not.toContain('f'.repeat(64))
      } finally {
        await cleanup()
      }
    })

    it('reports a manifest that is not valid JSON without attaching it', async () => {
      const { dir, cleanup } = await createTempDir()
      try {
        await writeFile(path.join(dir, '.saasfoundry.json'), '{ not json', 'utf8')
        const ctx = await collectReproContext('1.0.0-beta', dir)
        expect(ctx.manifest).toEqual({ status: 'invalid', rawLength: 10 })
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

    it('includes repro metadata and the .saasfoundry.json excerpt when available', () => {
      const body = formatBugBody(
        { title: 't', description: 'crash', source: 'scaffold', cliVersion: '1.0.0', includeRepro: true },
        {
          cliVersion: '1.0.0',
          nodeVersion: 'v22.0.0',
          platform: 'darwin',
          arch: 'arm64',
          manifest: { status: 'summarized', rawLength: 120, summary: { workflow: { workingBranch: 'develop' } } }
        }
      )
      expect(body).toContain('**Source:** scaffold')
      expect(body).toContain('**Node:** v22.0.0')
      expect(body).toContain('**Platform:** darwin (arm64)')
      expect(body).toContain('<summary>.saasfoundry.json excerpt</summary>')
      expect(body).toContain('"workingBranch": "develop"')
      expect(body).toContain('120-character manifest')
    })

    it('notes missing .saasfoundry.json in repro mode', () => {
      const body = formatBugBody(
        { title: 't', description: 'crash', source: 'cli', cliVersion: '1.0.0', includeRepro: true },
        { cliVersion: '1.0.0', nodeVersion: 'v22', platform: 'linux', arch: 'x64', manifest: { status: 'absent' } }
      )
      expect(body).toContain('_(no .saasfoundry.json found in cwd)_')
    })

    it('notes an unreadable .saasfoundry.json in repro mode', () => {
      const body = formatBugBody(
        { title: 't', description: 'crash', source: 'cli', cliVersion: '1.0.0', includeRepro: true },
        { cliVersion: '1.0.0', nodeVersion: 'v22', platform: 'linux', arch: 'x64', manifest: { status: 'unreadable' } }
      )
      expect(body).toContain('could not be read')
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

    it('files a bug from a real-sized full manifest with a body under the GitHub limit (#972)', async () => {
      const { dir, cleanup } = await createTempDir()
      try {
        const manifest = JSON.stringify(fullManifestFixture(), null, 2)
        expect(countCharacters(manifest)).toBeGreaterThan(GITHUB_ISSUE_BODY_LIMIT)
        await writeFile(path.join(dir, '.saasfoundry.json'), manifest, 'utf8')
        mockGhIssueCreate.mockResolvedValue({ number: 10, url: 'https://x/10', title: 't', state: 'OPEN', labels: [], author: { login: '' } })

        await fileBug({ title: 'auto-repro', description: 'fails on a full project', source: 'cli', cliVersion: '1.0.1', includeRepro: true, cwd: dir })

        expect(mockGhIssueCreate).toHaveBeenCalledTimes(1)
        const { body } = mockGhIssueCreate.mock.calls[0][0] as { body: string }
        expect(countCharacters(body)).toBeLessThanOrEqual(GITHUB_ISSUE_BODY_LIMIT)
        expect(body).toContain('"profile": "full"')
        expect(body).not.toMatch(/\b[a-f0-9]{64}\b/)
      } finally {
        await cleanup()
      }
    })

    it('measures the body before any call to GitHub and fails without sending it (#972)', async () => {
      const description = 'x'.repeat(GITHUB_ISSUE_BODY_LIMIT + 1)
      await expect(fileBug({ title: 'too long', description, source: 'cli', cliVersion: '1.0.0', includeRepro: false })).rejects.toThrow(IssueBodyTooLargeError)
      await expect(fileBug({ title: 'too long', description, source: 'cli', cliVersion: '1.0.0', includeRepro: false })).rejects.toThrow(/Nothing was sent to GitHub/)
      expect(mockEnsureGhAuth).not.toHaveBeenCalled()
      expect(mockReadFeedbackRepo).not.toHaveBeenCalled()
      expect(mockGhIssueCreate).not.toHaveBeenCalled()
    })
  })
})
