import { execSync } from 'child_process'
import { mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { findTool } from '../../../tools/catalogue'
import { checkConnection, readToolCredentials } from '../../../tools/connection-checks'

jest.mock('child_process', () => ({ execSync: jest.fn() }))
const mockedExecSync = execSync as jest.MockedFunction<typeof execSync>

function mockFetchOnce(status: number): void {
  ;(global.fetch as jest.Mock).mockResolvedValueOnce({ ok: status >= 200 && status < 300, status } as Response)
}

describe('connection checks', () => {
  let credDir: string

  beforeEach(async () => {
    credDir = join(tmpdir(), `sf-creds-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(credDir, { recursive: true })
    process.env.SF_CREDENTIALS_DIR = credDir
    global.fetch = jest.fn() as unknown as typeof fetch
    mockedExecSync.mockReset()
  })

  afterEach(async () => {
    delete process.env.SF_CREDENTIALS_DIR
    await rm(credDir, { recursive: true, force: true }).catch(() => {})
  })

  async function writeCreds(tool: string, account: string, body: string): Promise<void> {
    await mkdir(join(credDir, tool), { recursive: true })
    await writeFile(join(credDir, tool, `${account}.env`), body)
  }

  describe('readToolCredentials', () => {
    it('returns null when the bucket is missing', async () => {
      expect(await readToolCredentials('notion')).toBeNull()
    })

    it('parses KEY=VALUE lines and skips comments/blanks', async () => {
      await writeCreds('notion', 'default', '# a comment\nNOTION_API_TOKEN=secret123\n\nNOTION_API_VERSION=2022-06-28\n')
      expect(await readToolCredentials('notion')).toEqual({ NOTION_API_TOKEN: 'secret123', NOTION_API_VERSION: '2022-06-28' })
    })

    it('honours the requested account, returning null when absent', async () => {
      await writeCreds('notion', 'work', 'NOTION_API_TOKEN=w')
      expect(await readToolCredentials('notion', 'work')).toEqual({ NOTION_API_TOKEN: 'w' })
      expect(await readToolCredentials('notion', 'missing')).toBeNull()
    })
  })

  describe('github-projects (gh-backed)', () => {
    const ghp = findTool('tracker', 'github-projects')!

    it('is ok when gh auth status succeeds (live)', async () => {
      mockedExecSync.mockReturnValue('' as never)
      const res = await checkConnection(ghp)
      expect(res.status).toBe('ok')
      expect(mockedExecSync).toHaveBeenCalledWith('gh auth status', expect.anything())
    })

    it('warns (never throws) when gh auth status fails', async () => {
      mockedExecSync.mockImplementation(() => {
        throw new Error('not logged in')
      })
      expect(await checkConnection(ghp)).toEqual({ status: 'warn', detail: expect.stringContaining('gh auth login') })
    })

    it('degrades to a local token presence check under --no-network', async () => {
      mockedExecSync.mockReturnValue('gho_token\n' as never)
      const res = await checkConnection(ghp, { noNetwork: true })
      expect(res.status).toBe('ok')
      expect(mockedExecSync).toHaveBeenCalledWith('gh auth token', expect.anything())
      expect(global.fetch).not.toHaveBeenCalled()
    })
  })

  describe('local-markdown (no remote)', () => {
    it('is always ok and never hits the network', async () => {
      const res = await checkConnection(findTool('docs', 'local-markdown')!)
      expect(res.status).toBe('ok')
      expect(global.fetch).not.toHaveBeenCalled()
    })
  })

  describe('credential-backed tools', () => {
    const notion = findTool('docs', 'notion')!

    it('warns and defers when no credential is present (no ping)', async () => {
      const res = await checkConnection(notion)
      expect(res).toEqual({ status: 'warn', detail: 'no credential found — entry deferred' })
      expect(global.fetch).not.toHaveBeenCalled()
    })

    it('skips the ping but stays ok when credential present under --no-network', async () => {
      await writeCreds('notion', 'default', 'NOTION_API_TOKEN=secret')
      const res = await checkConnection(notion, { noNetwork: true })
      expect(res).toEqual({ status: 'ok', detail: 'credential present (offline)' })
      expect(global.fetch).not.toHaveBeenCalled()
    })

    it('pings Notion and reports ok on 200', async () => {
      await writeCreds('notion', 'default', 'NOTION_API_TOKEN=secret')
      mockFetchOnce(200)
      expect((await checkConnection(notion)).status).toBe('ok')
      expect(global.fetch).toHaveBeenCalledWith('https://api.notion.com/v1/users/me', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer secret' }) }))
    })

    it('warns on a non-2xx Notion response', async () => {
      await writeCreds('notion', 'default', 'NOTION_API_TOKEN=secret')
      mockFetchOnce(401)
      expect(await checkConnection(notion)).toEqual({ status: 'warn', detail: 'Notion API returned 401' })
    })

    it('warns (never throws) when the ping rejects', async () => {
      await writeCreds('figma', 'default', 'FIGMA_API_TOKEN=tok')
      ;(global.fetch as jest.Mock).mockRejectedValueOnce(new Error('network down'))
      expect(await checkConnection(findTool('design', 'figma')!)).toEqual({ status: 'warn', detail: expect.stringContaining('network down') })
    })

    it('warns when stored credentials are incomplete', async () => {
      await writeCreds('atlassian', 'default', 'ATLASSIAN_EMAIL=a@b.c')
      expect(await checkConnection(findTool('tracker', 'jira')!)).toEqual({ status: 'warn', detail: expect.stringContaining('incomplete') })
      expect(global.fetch).not.toHaveBeenCalled()
    })

    it('pings Atlassian with basic auth against the configured site', async () => {
      await writeCreds('atlassian', 'default', 'ATLASSIAN_EMAIL=a@b.c\nATLASSIAN_API_TOKEN=tok\nATLASSIAN_SITE=acme.atlassian.net')
      mockFetchOnce(200)
      expect((await checkConnection(findTool('tracker', 'jira')!)).status).toBe('ok')
      expect(global.fetch).toHaveBeenCalledWith('https://acme.atlassian.net/rest/api/3/myself', expect.anything())
    })
  })
})
