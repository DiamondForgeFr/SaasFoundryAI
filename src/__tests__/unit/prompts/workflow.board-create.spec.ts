import inquirer from 'inquirer'
import { execFileSync, execSync } from 'child_process'

jest.mock('inquirer')
jest.mock('../../../prompts/workflow.board-view', () => ({ configureBoardView: jest.fn(() => ({ created: true, visible: [], missing: [] })) }))
jest.mock('child_process', () => ({ ...jest.requireActual('child_process'), execSync: jest.fn(), execFileSync: jest.fn() }))

import { githubOwnerOf, setupGitHubProjectWithAutoCreation } from '../../../prompts/workflow.prompts'

const mockedExec = execSync as unknown as jest.Mock
const mockedExecFile = execFileSync as unknown as jest.Mock
const mockedPrompt = inquirer.prompt as unknown as jest.Mock

/** A `gh` that knows one user, `acme`, and answers the calls board creation makes. */
function fakeGh(file: string, args: string[], options: { input?: string } = {}): string {
  const cmd = [file, ...args].join(' ')
  if (cmd === 'gh api users/acme --jq .type') return 'User\n'
  if (cmd.startsWith('gh project link')) return ''
  if (cmd === 'gh api graphql --input -') {
    const { query, variables } = JSON.parse(options.input ?? '{}')
    if (query.includes('user(login: $login)') && variables.login === 'acme') return JSON.stringify({ data: { user: { id: 'U_1' } } })
    if (query.includes('createProjectV2')) return JSON.stringify({ data: { createProjectV2: { projectV2: { id: 'P_1', number: 7, url: 'https://github.com/users/acme/projects/7' } } } })
    // No Status field: creation returns the board without configuring it
    if (query.includes('field(name: "Status")')) return JSON.stringify({ data: { node: { field: null } } })
  }
  throw new Error(`unexpected command: ${cmd}`)
}

/** The GraphQL bodies sent to `gh api graphql`, in order. */
const graphqlBodies = (): { query: string; variables: Record<string, unknown> }[] =>
  mockedExecFile.mock.calls.filter(([, args]) => args[1] === 'graphql').map(([, , options]) => JSON.parse(options.input))

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
    mockedExec.mockImplementation((cmd: string) => {
      if (cmd === 'gh auth status') return ''
      throw new Error(`unexpected command: ${cmd}`)
    })
    mockedExecFile.mockImplementation(fakeGh)
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => logSpy.mockRestore())

  it('creates the board under the owner of an scp-style remote and links it, asking nothing', async () => {
    const url = await setupGitHubProjectWithAutoCreation('acme', [], 'git@github.com:acme/my.repo.git', { interactive: false })

    expect(url).toBe('https://github.com/users/acme/projects/7')
    expect(mockedExecFile).toHaveBeenCalledWith('gh', ['project', 'link', '7', '--owner', 'acme', '--repo', 'acme/my.repo'], expect.anything())
    expect(mockedPrompt).not.toHaveBeenCalled()
  })

  it('creates nothing and asks nothing without a GitHub remote', async () => {
    const url = await setupGitHubProjectWithAutoCreation('acme', [], undefined, { interactive: false })

    expect(url).toBeNull()
    expect(mockedPrompt).not.toHaveBeenCalled()
    expect(mockedExec.mock.calls.map(([cmd]) => cmd)).toEqual(['gh auth status'])
    expect(logSpy.mock.calls.flat().join('\n')).toContain('No GitHub remote to take the board owner from')
  })

  // #897 — a quote ended the shell argument, a double quote the GraphQL string
  it.each([`Bob's "Shop"`, "it's $(whoami)", 'back\\slash'])('titles the board exactly %p, as a GraphQL variable', async (title) => {
    const url = await setupGitHubProjectWithAutoCreation(title, [], 'https://github.com/acme/notulia.git', { interactive: false })

    expect(url).toBe('https://github.com/users/acme/projects/7')
    const create = graphqlBodies().find((body) => body.query.includes('createProjectV2'))
    expect(create?.variables).toEqual({ ownerId: 'U_1', title })
    expect(create?.query).not.toContain(title)
    expect(mockedExec.mock.calls.map(([cmd]) => cmd)).toEqual(['gh auth status'])
  })

  it('sends the Status options as a variable, quotes included', async () => {
    mockedExecFile.mockImplementation((file: string, args: string[], options: { input?: string } = {}) => {
      const query: string = options.input ? JSON.parse(options.input).query : ''
      if (query.includes('field(name: "Status")')) return JSON.stringify({ data: { node: { field: { id: 'F_1', name: 'Status' } } } })
      if (query.includes('updateProjectV2Field')) return JSON.stringify({ data: {} })
      return fakeGh(file, args, options)
    })
    const statuses = [{ name: 'Backlog', color: 'GRAY' as const, description: `Raw "ideas" the team hasn't challenged` }]

    await setupGitHubProjectWithAutoCreation('acme', statuses, 'https://github.com/acme/notulia.git', { interactive: false })

    const update = graphqlBodies().find((body) => body.query.includes('updateProjectV2Field'))
    expect(update?.variables).toEqual({ fieldId: 'F_1', options: [{ name: 'Backlog', color: 'GRAY', description: `Raw "ideas" the team hasn't challenged` }] })
  })

  it('still confirms the detected owner interactively', async () => {
    mockedPrompt.mockResolvedValue({ confirmOwner: true })

    await setupGitHubProjectWithAutoCreation('acme', [], 'https://github.com/acme/notulia.git')

    expect(mockedPrompt).toHaveBeenCalledWith([expect.objectContaining({ name: 'confirmOwner' })])
  })
})
