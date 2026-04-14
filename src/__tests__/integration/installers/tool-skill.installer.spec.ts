import { mkdir, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

import { installToolSkill } from '../../../installers/tool-skill.installer'
import { expectFileExists, expectFileContains, expectFileNotExists } from '../../helpers/assertions'

describe('installToolSkill (integration)', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = join(tmpdir(), `sf-tool-skill-integ-${Date.now()}`)
    await mkdir(tempDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  })

  // ── Copies Tool Skill Template ────────────────────────────

  it('should copy github-projects tool skill template to correct path', async () => {
    await installToolSkill({
      targetPath: tempDir,
      tool: 'github-projects'
    })

    const toolPath = join(tempDir, '.claude/skills/sf-tool-github-projects')
    await expectFileExists(join(toolPath, 'SKILL.md'))
    await expectFileExists(join(toolPath, 'github-projects-cli.sh'))
  })

  it('should copy jira tool skill template to correct path', async () => {
    await installToolSkill({
      targetPath: tempDir,
      tool: 'jira'
    })

    const toolPath = join(tempDir, '.claude/skills/sf-tool-jira')
    await expectFileExists(join(toolPath, 'SKILL.md'))
    await expectFileExists(join(toolPath, 'jira-cli.sh'))
  })

  it('should copy notion tool skill template to correct path', async () => {
    await installToolSkill({
      targetPath: tempDir,
      tool: 'notion'
    })

    const toolPath = join(tempDir, '.claude/skills/sf-tool-notion')
    await expectFileExists(join(toolPath, 'SKILL.md'))
    await expectFileExists(join(toolPath, 'notion-cli.sh'))
  })

  it('should copy linear tool skill template to correct path', async () => {
    await installToolSkill({
      targetPath: tempDir,
      tool: 'linear'
    })

    const toolPath = join(tempDir, '.claude/skills/sf-tool-linear')
    await expectFileExists(join(toolPath, 'SKILL.md'))
    await expectFileExists(join(toolPath, 'linear-cli.sh'))
  })

  // ── Creates .env With Credentials ─────────────────────────

  it('should create .env file with credentials when provided', async () => {
    await installToolSkill({
      targetPath: tempDir,
      tool: 'jira',
      credentials: {
        JIRA_API_TOKEN: 'my-jira-token',
        JIRA_BASE_URL: 'https://myteam.atlassian.net',
        JIRA_EMAIL: 'user@example.com'
      }
    })

    const envPath = join(tempDir, '.claude/skills/sf-tool-jira/.env')
    await expectFileExists(envPath)
    await expectFileContains(envPath, 'JIRA_API_TOKEN="my-jira-token"')
    await expectFileContains(envPath, 'JIRA_BASE_URL="https://myteam.atlassian.net"')
    await expectFileContains(envPath, 'JIRA_EMAIL="user@example.com"')
  })

  // ── Does NOT Create .env Without Credentials ──────────────

  it('should NOT create .env when no credentials provided', async () => {
    await installToolSkill({
      targetPath: tempDir,
      tool: 'github-projects'
    })

    const envPath = join(tempDir, '.claude/skills/sf-tool-github-projects/.env')
    await expectFileNotExists(envPath)
  })

  it('should NOT create .env when credentials is an empty object', async () => {
    await installToolSkill({
      targetPath: tempDir,
      tool: 'github-projects',
      credentials: {}
    })

    const envPath = join(tempDir, '.claude/skills/sf-tool-github-projects/.env')
    await expectFileNotExists(envPath)
  })

  // ── Creates Skills Directory ──────────────────────────────

  it('should create the .claude/skills directory if it does not exist', async () => {
    // tempDir has no .claude directory at all
    await installToolSkill({
      targetPath: tempDir,
      tool: 'notion'
    })

    await expectFileExists(join(tempDir, '.claude/skills'))
    await expectFileExists(join(tempDir, '.claude/skills/sf-tool-notion'))
  })

  it('should work when .claude/skills directory already exists', async () => {
    // Pre-create the skills directory
    await mkdir(join(tempDir, '.claude/skills'), { recursive: true })

    await installToolSkill({
      targetPath: tempDir,
      tool: 'linear'
    })

    await expectFileExists(join(tempDir, '.claude/skills/sf-tool-linear/SKILL.md'))
  })

  // ── Multiple Tool Installs ────────────────────────────────

  it('should install multiple tools side by side', async () => {
    await installToolSkill({
      targetPath: tempDir,
      tool: 'github-projects'
    })

    await installToolSkill({
      targetPath: tempDir,
      tool: 'jira',
      credentials: {
        JIRA_API_TOKEN: 'token'
      }
    })

    await expectFileExists(join(tempDir, '.claude/skills/sf-tool-github-projects/SKILL.md'))
    await expectFileExists(join(tempDir, '.claude/skills/sf-tool-jira/SKILL.md'))
    await expectFileExists(join(tempDir, '.claude/skills/sf-tool-jira/.env'))
    await expectFileNotExists(join(tempDir, '.claude/skills/sf-tool-github-projects/.env'))
  })
})
