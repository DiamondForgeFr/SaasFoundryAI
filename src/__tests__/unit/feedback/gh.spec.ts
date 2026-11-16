jest.mock('child_process', () => ({
  execFile: jest.fn()
}))

import { execFile } from 'child_process'

import { GITHUB_ISSUE_BODY_LIMIT, IssueBodyTooLargeError } from '../../../feedback/body-limit'
import { ghAddReaction, ghCurrentUser, ghIssueComment, ghIssueCreate, ghIssueSearch } from '../../../feedback/gh'

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

  describe('a failed call shows what gh answered, not what was sent (#972)', () => {
    const BODY = 'BODY-CANARY '.repeat(500)

    it('names the call and relays gh stderr, without the title, the body or any flag', async () => {
      mockError('GraphQL: Body is too long (maximum is 65536 characters) (createIssue)')
      const failure = ghIssueCreate({ repo: 'OWNER/REPO', title: 'TITLE-CANARY', body: BODY, labels: ['cli-bug'] })
      await expect(failure).rejects.toThrow('gh issue create failed: GraphQL: Body is too long (maximum is 65536 characters) (createIssue)')
      await failure.catch((error: Error) => {
        expect(error.message).not.toContain('BODY-CANARY')
        expect(error.message).not.toContain('TITLE-CANARY')
        expect(error.message).not.toContain('--body')
        expect(error.message.length).toBeLessThan(200)
      })
    })

    it('does not fall back to the message Node builds, which quotes every argument', async () => {
      mockExecFile.mockImplementationOnce((_cmd: string, args: string[], _opts: unknown, cb: (err: Error & { code?: number }, stdout: string, stderr: string) => void) => {
        const err = new Error(`Command failed: gh ${args.join(' ')}`) as Error & { code?: number }
        err.code = 1
        cb(err, '', '')
      })
      const failure = ghIssueCreate({ repo: 'OWNER/REPO', title: 't', body: BODY })
      await expect(failure).rejects.toThrow('gh issue create failed: gh exited with code 1 and printed nothing')
      await failure.catch((error: Error) => expect(error.message).not.toContain('BODY-CANARY'))
    })

    it('says so when gh is not installed', async () => {
      mockExecFile.mockImplementationOnce((_cmd: string, _args: string[], _opts: unknown, cb: (err: Error & { code?: string }, stdout: string, stderr: string) => void) => {
        const err = new Error('spawn gh ENOENT') as Error & { code?: string }
        err.code = 'ENOENT'
        cb(err, '', '')
      })
      await expect(ghCurrentUser()).rejects.toThrow('gh api user failed: the gh executable was not found on PATH')
    })

    it('keeps the words of a comment call that identify it, and drops the flags', async () => {
      mockError('HTTP 403')
      await expect(ghIssueComment('OWNER/REPO', 42, 'COMMENT-CANARY')).rejects.toThrow(/^gh issue comment 42 failed: HTTP 403$/)
    })

    it('clips a stderr that runs on', async () => {
      mockError('e'.repeat(10_000))
      const failure = ghIssueSearch({ repo: 'OWNER/REPO' })
      await failure.catch((error: Error) => expect(error.message.length).toBeLessThan(2100))
      await expect(failure).rejects.toThrow(/^gh issue list failed: e+…$/)
    })
  })

  it('ghIssueCreate refuses a body over the GitHub limit without starting gh (#972)', async () => {
    const body = 'x'.repeat(GITHUB_ISSUE_BODY_LIMIT + 1)
    await expect(ghIssueCreate({ repo: 'OWNER/REPO', title: 't', body })).rejects.toThrow(IssueBodyTooLargeError)
    expect(mockExecFile).not.toHaveBeenCalled()
  })

  it('ghIssueCreate accepts a body of exactly the limit', async () => {
    mockStdout('https://github.com/OWNER/REPO/issues/43\n')
    await ghIssueCreate({ repo: 'OWNER/REPO', title: 't', body: 'x'.repeat(GITHUB_ISSUE_BODY_LIMIT) })
    expect(mockExecFile).toHaveBeenCalledTimes(1)
  })
})
