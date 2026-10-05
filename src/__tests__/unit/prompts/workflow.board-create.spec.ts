import inquirer from 'inquirer'
import { execFileSync } from 'child_process'

jest.mock('inquirer')
jest.mock('../../../prompts/workflow.board-view', () => ({ configureBoardView: jest.fn(() => ({ created: true, visible: [], missing: [] })) }))
jest.mock('child_process', () => ({ ...jest.requireActual('child_process'), execFileSync: jest.fn() }))

import { ghRemedy, ghState, githubOwnerOf, setupGitHubProjectWithAutoCreation } from '../../../prompts/workflow.prompts'

const mockedExecFile = execFileSync as unknown as jest.Mock
const mockedPrompt = inquirer.prompt as unknown as jest.Mock

/** A `gh` that knows one user, `acme`, and answers the calls board creation makes. */
function fakeGh(file: string, args: string[], options: { input?: string } = {}): string {
  const cmd = [file, ...args].join(' ')
  if (cmd === 'gh auth status') return ''
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
    expect(mockedExecFile.mock.calls.map(([, args]) => args.join(' '))).toEqual(['auth status'])
    expect(logSpy.mock.calls.flat().join('\n')).toContain('No GitHub remote to take the board owner from')
  })

  // #897 — a quote ended the shell argument, a double quote the GraphQL string
  it.each([`Bob's "Shop"`, "it's $(whoami)", 'back\\slash'])('titles the board exactly %p, as a GraphQL variable', async (title) => {
    const url = await setupGitHubProjectWithAutoCreation(title, [], 'https://github.com/acme/notulia.git', { interactive: false })

    expect(url).toBe('https://github.com/users/acme/projects/7')
    const create = graphqlBodies().find((body) => body.query.includes('createProjectV2'))
    expect(create?.variables).toEqual({ ownerId: 'U_1', title })
    expect(create?.query).not.toContain(title)
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

// #898 — a machine without gh was told to run `gh auth login`
describe('ghState', () => {
  beforeEach(() => jest.clearAllMocks())

  const failWith = (error: Partial<NodeJS.ErrnoException> & { status?: number }) =>
    mockedExecFile.mockImplementation(() => {
      throw Object.assign(new Error('gh failed'), error)
    })

  it('is ready when gh auth status succeeds', () => {
    mockedExecFile.mockReturnValue('')
    expect(ghState()).toBe('ready')
  })

  it('is missing when gh is not on PATH, and names the install page instead of gh auth login', () => {
    failWith({ code: 'ENOENT' })
    expect(ghState()).toBe('missing')
    expect(ghRemedy('missing')).toBe('GitHub CLI (gh) is not installed. Install it from https://cli.github.com, then run: gh auth login')
  })

  it('is unauthenticated when gh answers with an error', () => {
    failWith({ status: 1 })
    expect(ghState()).toBe('unauthenticated')
    expect(ghRemedy('unauthenticated')).toBe('GitHub CLI not authenticated. Run: gh auth login')
  })

  it('tells --create-board that gh is missing and creates nothing', async () => {
    failWith({ code: 'ENOENT' })
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})

    const url = await setupGitHubProjectWithAutoCreation('acme', [], 'https://github.com/acme/notulia.git', { interactive: false })

    expect(url).toBeNull()
    const output = logSpy.mock.calls.flat().join('\n')
    expect(output).toContain('GitHub CLI (gh) is not installed')
    expect(output).not.toContain('not authenticated')
    logSpy.mockRestore()
  })
})
