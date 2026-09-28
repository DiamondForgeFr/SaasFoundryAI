import { execSync } from 'node:child_process'
import { mkdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { detectGitRepo, getCurrentBranch, getDefaultBranch, getRepoName, getRepoRoot, getRemoteUrl, isGitRepo } from '../../../utils/git-info'

const sh = (cmd: string, cwd: string) => execSync(cmd, { cwd, stdio: ['pipe', 'pipe', 'pipe'] })

describe('git-info', () => {
  let dir: string

  beforeEach(async () => {
    dir = join(tmpdir(), `sf-git-info-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(dir, { recursive: true })
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  })

  const initRepo = (branch = 'main') => {
    sh(`git init -b ${branch}`, dir)
    sh('git -c user.email=t@t -c user.name=t commit --allow-empty -m init', dir)
  }

  it('isGitRepo distinguishes repos from plain directories', () => {
    expect(isGitRepo(dir)).toBe(false)
    initRepo()
    expect(isGitRepo(dir)).toBe(true)
  })

  it('reads the repo root and the current branch', () => {
    initRepo('develop')
    expect(getRepoRoot(dir)).toContain('sf-git-info-')
    expect(getCurrentBranch(dir)).toBe('develop')
  })

  it('falls back to main/master heuristics for the default branch without a remote', () => {
    initRepo('main')
    sh('git checkout -b feature/x', dir)
    expect(getDefaultBranch(dir)).toBe('main')
  })

  it('falls back to the current branch when neither main nor master exists', () => {
    initRepo('trunk')
    expect(getDefaultBranch(dir)).toBe('trunk')
  })

  it('derives the repo name from the origin URL, stripping .git', () => {
    initRepo()
    sh('git remote add origin https://github.com/acme/notulias.git', dir)
    expect(getRemoteUrl(dir)).toBe('https://github.com/acme/notulias.git')
    expect(getRepoName(dir)).toBe('notulias')
  })

  it('falls back to the directory name without a remote', () => {
    initRepo()
    expect(getRepoName(dir)).toContain('sf-git-info-')
  })

  it('detectGitRepo returns null outside a repo and a full info object inside', () => {
    expect(detectGitRepo(dir)).toBeNull()

    initRepo('main')
    sh('git remote add origin git@github.com:acme/notulias.git', dir)
    const info = detectGitRepo(dir)

    expect(info).toMatchObject({
      name: 'notulias',
      currentBranch: 'main',
      defaultBranch: 'main',
      remoteUrl: 'git@github.com:acme/notulias.git'
    })
  })
})
