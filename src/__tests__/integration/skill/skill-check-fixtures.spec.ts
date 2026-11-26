import { execFile } from 'child_process'
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { promisify } from 'util'

// Layer 2 of the skill check (#1096) asks a real agent to plan inside a generated project. This spec generates the
// disposable projects the way the replay does (`run.mjs fixtures`, this checkout's own CLI, built by the integration
// project's global setup) and proves what an agent is promised: the projects are the templates under test, hold no
// `.env` file and no credential, and nothing of the generating environment reaches them.

const execFileAsync = promisify(execFile)
const REPO_ROOT = path.resolve(__dirname, '../../../..')
const RUN = path.join(REPO_ROOT, 'tests/skill-check/run.mjs')
const TOKEN = 'ghp_skillcheck_marker_0123456789'

function files(dir: string): string[] {
  return (readdirSync(dir, { recursive: true }) as string[]).map((entry) => entry.split(path.sep).join('/')).filter((entry) => lstatSync(path.join(dir, entry)).isFile())
}

describe('skill check fixtures: the disposable projects of the replay', () => {
  let out: string
  let made: Record<string, { dir: string; removedEnvFiles: string[] }>

  beforeAll(async () => {
    out = mkdtempSync(path.join(tmpdir(), 'skill-check-fixtures-'))
    const { stdout } = await execFileAsync(process.execPath, [RUN, 'fixtures', '--json', '--out', out, '--only', 'harness-solo,harness-srs,full-monorepo,poc-folder,dogfood'], {
      env: { PATH: process.env.PATH, GH_TOKEN: TOKEN, GITHUB_TOKEN: TOKEN, SF_PROJECTS_TOKEN: TOKEN, NOTION_API_TOKEN: TOKEN },
      maxBuffer: 64 * 1024 * 1024
    })
    made = JSON.parse(stdout)
  }, 180000)

  afterAll(() => {
    rmSync(out, { recursive: true, force: true })
  })

  it('generates each project with this checkout, in a folder of its own', () => {
    expect(Object.keys(made).sort()).toEqual(['dogfood', 'full-monorepo', 'harness-solo', 'harness-srs', 'poc-folder'])
    const solo = JSON.parse(readFileSync(path.join(made['harness-solo'].dir, '.saasfoundry.json'), 'utf8'))
    expect(solo.workflow.template).toBe('SaaSFoundry Solo')
    expect(existsSync(path.join(made['harness-solo'].dir, '.claude/skills/sf-workflow/SKILL.md'))).toBe(true)
    expect(existsSync(path.join(made['harness-solo'].dir, '.agents/skills/sf-workflow/SKILL.md'))).toBe(true)
    expect(existsSync(path.join(made['harness-solo'].dir, '.claude/skills/tool-saasfoundry/SKILL.md'))).toBe(true)
  })

  it('declares an SRS without a credential, and projects the skill for Codex', () => {
    const srs = JSON.parse(readFileSync(path.join(made['harness-srs'].dir, '.saasfoundry.json'), 'utf8'))
    expect(srs.tools.srs).toMatchObject({ enabled: true, backend: 'notion' })
    expect(srs.tools.srs.rootPage.url).toContain('notion.invalid')
    expect(existsSync(path.join(made['harness-srs'].dir, '.claude/skills/sf-srs/SKILL.md'))).toBe(true)
    expect(existsSync(path.join(made['harness-srs'].dir, '.agents/skills/sf-srs/SKILL.md'))).toBe(true)
  })

  it('removes every .env file the generator wrote', () => {
    const mono = made['full-monorepo']
    expect(mono.removedEnvFiles).toEqual(expect.arrayContaining(['fixture-mono/apps/api/.env', 'fixture-mono/apps/web/.env']))
    for (const fixture of Object.values(made)) {
      const names = files(fixture.dir).map((file) => file.split('/').at(-1) as string)
      expect(names.filter((name) => /^\.env(\..+)?$/.test(name) && !/\.(example|sample)$/.test(name))).toEqual([])
    }
    expect(existsSync(path.join(mono.dir, 'apps/api/.env'))).toBe(false)
    expect(existsSync(path.join(mono.dir, 'apps/api/.env.test'))).toBe(false)
  })

  it('installs no dependency and leaves no scratch folder or home behind', () => {
    for (const fixture of Object.values(made)) expect(files(fixture.dir).filter((file) => file.includes('node_modules/'))).toEqual([])
    expect(existsSync(path.join(out, '.scratch'))).toBe(false)
  })

  it('carries nothing of the environment it was generated in', () => {
    for (const fixture of Object.values(made)) {
      for (const file of files(fixture.dir)) {
        if (file.startsWith('.git/')) continue
        const full = path.join(fixture.dir, file)
        if (statSync(full).size > 2 * 1024 * 1024) continue
        expect(readFileSync(full, 'utf8')).not.toContain(TOKEN)
      }
    }
  })

  it('copies only tracked harness files into the dogfood project', () => {
    const dogfood = files(made.dogfood.dir)
    expect(dogfood).toEqual(expect.arrayContaining(['AGENTS.md', '.claude/skills/sf-workflow/SKILL.md', 'scaffolds/skills-templates/workflow/SKILL.md', 'package.json']))
    expect(dogfood.filter((file) => file.startsWith('.claude/worktrees/') || file.includes('node_modules/') || file.startsWith('dist/') || file.startsWith('tests/'))).toEqual([])
  })

  it('leaves a folder with a prototype and no manifest for the discovery scenarios', () => {
    const poc = files(made['poc-folder'].dir)
    expect(poc).toEqual(expect.arrayContaining(['package.json', 'src/index.js', '.claude/skills/tool-saasfoundry/SKILL.md']))
    expect(poc).not.toContain('.saasfoundry.json')
  })
})
