import inquirer from 'inquirer'
import { execSync } from 'child_process'

jest.mock('inquirer')
jest.mock('child_process', () => ({ ...jest.requireActual('child_process'), execSync: jest.fn() }))

import { githubOwnerOf, setupGitHubProjectWithAutoCreation } from '../../../prompts/workflow.prompts'

const mockedExec = execSync as unknown as jest.Mock
const mockedPrompt = inquirer.prompt as unknown as jest.Mock

/** A `gh` that knows one user, `acme`, and answers the calls board creation makes. */
function fakeGh(cmd: string): string {
  if (cmd === 'gh auth status') return ''
  if (cmd.startsWith('gh api users/acme --jq .type')) return 'User\n'
  if (cmd.includes('user(login: "acme")')) return JSON.stringify({ data: { user: { id: 'U_1' } } })
  if (cmd.includes('createProjectV2')) return JSON.stringify({ data: { createProjectV2: { projectV2: { id: 'P_1', number: 7, url: 'https://github.com/users/acme/projects/7' } } } })
  if (cmd.startsWith('gh project link')) return ''
  // No Status field: creation returns the board without configuring it
  if (cmd.includes('field(name: "Status")')) return JSON.stringify({ data: { node: { field: null } } })
  throw new Error(`unexpected command: ${cmd}`)
}

describe('githubOwnerOf (#821)', () => {
  it.each([
    ['https://github.com/acme/notulia.git', { owner: 'acme', repo: 'notulia' }],
    ['git@github.com:acme/notulia.git', { owner: 'acme', repo: 'notulia' }],
    ['ssh://git@github.com/acme/notulia.git', { owner: 'acme', repo: 'notulia' }],
    ['https://github.com/acme/my.repo.git', { owner: 'acme', repo: 'my.repo' }],
    ['https://github.com/orgs/acme/projects/3', { owner: 'acme' }]
  ])('reads %s', (url, expected) => {
    expect(githubOwnerOf(url)).toEqual(expected)
  })

  it('rejects a remote hosted elsewhere', () => {
    expect(githubOwnerOf('git@gitlab.com:acme/notulia.git')).toBeUndefined()
  })
})

describe('setupGitHubProjectWithAutoCreation without prompts (--create-board)', () => {
  let logSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    mockedExec.mockImplementation(fakeGh)
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => logSpy.mockRestore())

  it('creates the board under the owner of an scp-style remote and links it, asking nothing', async () => {
    const url = await setupGitHubProjectWithAutoCreation('acme', [], 'git@github.com:acme/my.repo.git', { interactive: false })

    expect(url).toBe('https://github.com/users/acme/projects/7')
    expect(mockedExec).toHaveBeenCalledWith('gh project link 7 --owner acme --repo acme/my.repo', expect.anything())
    expect(mockedPrompt).not.toHaveBeenCalled()
  })

  it('creates nothing and asks nothing without a GitHub remote', async () => {
    const url = await setupGitHubProjectWithAutoCreation('acme', [], undefined, { interactive: false })

    expect(url).toBeNull()
    expect(mockedPrompt).not.toHaveBeenCalled()
    expect(mockedExec.mock.calls.map(([cmd]) => cmd)).toEqual(['gh auth status'])
    expect(logSpy.mock.calls.flat().join('\n')).toContain('No GitHub remote to take the board owner from')
  })

  it('still confirms the detected owner interactively', async () => {
    mockedPrompt.mockResolvedValue({ confirmOwner: true })

    await setupGitHubProjectWithAutoCreation('acme', [], 'https://github.com/acme/notulia.git')

    expect(mockedPrompt).toHaveBeenCalledWith([expect.objectContaining({ name: 'confirmOwner' })])
  })
})
