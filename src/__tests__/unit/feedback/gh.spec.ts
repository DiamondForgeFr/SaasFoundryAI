jest.mock('child_process', () => ({
  execFile: jest.fn()
}))

import { execFile } from 'child_process'

import { ghAddReaction, ghCurrentUser, ghIssueCreate, ghIssueSearch } from '../../../feedback/gh'

const mockExecFile = execFile as unknown as jest.Mock

function mockStdout(stdout: string): void {
  mockExecFile.mockImplementationOnce((_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
    cb(null, stdout, '')
  })
}

function mockError(stderr: string): void {
  mockExecFile.mockImplementationOnce((_cmd: string, _args: string[], _opts: unknown, cb: (err: Error & { stderr?: string }, stdout: string, stderr: string) => void) => {
    const err = new Error('Command failed') as Error & { stderr?: string }
    err.stderr = stderr
    cb(err, '', stderr)
  })
}

describe('feedback/gh', () => {
  beforeEach(() => {
    mockExecFile.mockReset()
  })

  it('ghIssueSearch parses JSON output and forwards flags', async () => {
    mockStdout(JSON.stringify([{ number: 1, title: 'Add Stripe', state: 'OPEN', url: 'https://x', labels: [], author: { login: 'alice' } }]))
    const issues = await ghIssueSearch({ repo: 'OWNER/REPO', labels: ['module-request'], state: 'open', search: 'stripe', limit: 5 })
    expect(issues).toHaveLength(1)
    expect(issues[0].title).toBe('Add Stripe')

    const call = mockExecFile.mock.calls[0]
    const args: string[] = call[1]
    expect(args.slice(0, 4)).toEqual(['issue', 'list', '--repo', 'OWNER/REPO'])
    expect(args).toContain('--state')
    expect(args).toContain('--label')
    expect(args).toContain('module-request')
    expect(args).toContain('--limit')
    expect(args).toContain('5')
  })

  it('ghIssueCreate extracts the new issue number from the URL', async () => {
    mockStdout('https://github.com/OWNER/REPO/issues/42\n')
    const created = await ghIssueCreate({ repo: 'OWNER/REPO', title: 't', body: 'b', labels: ['module-request'] })
    expect(created.number).toBe(42)
    expect(created.url).toBe('https://github.com/OWNER/REPO/issues/42')
  })

  it('ghAddReaction calls the reactions endpoint with correct content', async () => {
    mockStdout('{}')
    await ghAddReaction({ repo: 'OWNER/REPO', issueNumber: 99, content: '+1' })
    const args: string[] = mockExecFile.mock.calls[0][1]
    expect(args[0]).toBe('api')
    expect(args).toContain('/repos/OWNER/REPO/issues/99/reactions')
    expect(args).toContain('content=+1')
  })

  it('ghCurrentUser trims the login', async () => {
    mockStdout('octocat\n')
    const login = await ghCurrentUser()
    expect(login).toBe('octocat')
  })

  it('execGh surfaces stderr on failure', async () => {
    mockError('HTTP 404: Not Found')
    await expect(ghIssueSearch({ repo: 'OWNER/REPO' })).rejects.toThrow(/HTTP 404/)
  })
})
