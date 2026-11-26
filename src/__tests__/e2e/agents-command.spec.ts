import { execFileSync, spawnSync } from '../helpers/bounded-child'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

import { GENERATED_INSTRUCTIONS } from '../../harness/agent-instructions'
import { CLAUDE_CAPTURE_COMMAND, CODEX_CAPTURE_COMMAND } from '../../harness/delegation-hooks'

const ROOT = resolve(__dirname, '../../..')

// Every test spawns the compiled CLI several times, and some run Git beside it (a clone, a linked worktree). On an idle
// machine the file takes 34 s and its slowest test 6.4 s; on 2026-11-16, at a load average near 100 on 10 cores, the
// file took 305 s (9 times longer) and that test went past the e2e project's 60 s (#1240). 120 s is twice what the
// slowest test takes at the worst slowdown measured: a hang guard, not what the tests check.
jest.setTimeout(120_000)

describe('compiled sf agents commands', () => {
  let project: string
  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), 'sf-agents-cli-'))
    await writeFile(
      join(project, '.saasfoundry.json'),
      JSON.stringify({ version: 'test', projectName: 'agents-demo', generatedAt: '2026-09-08', structure: 'cli', modules: { harness: { version: 1 } } })
    )
    execFileSync(
      process.execPath,
      [
        '-e',
        "require(process.argv[1]).installHarness({targetPath:process.cwd(),projectName:'agents-demo',version:'test'}).catch(e=>{console.error(e);process.exitCode=1})",
        join(ROOT, 'dist/installers/harness.installer.js')
      ],
      { cwd: project, stdio: 'pipe' }
    )
  })
  afterEach(async () => rm(project, { recursive: true, force: true }))
  // `enable`, `replace` and `refresh` read the developer's Kimi Code configuration when kimi is declared (FR-MAH-022): never the
  // real one in a test, so KIMI_CODE_HOME names a folder next to the project, which a test may fill.
  const kimiHome = () => `${project}-kimi-home`
  function run(...args: string[]) {
    return spawnSync(process.execPath, [join(ROOT, 'bin/sf.js'), 'agents', ...args], { cwd: project, encoding: 'utf8', env: { ...process.env, KIMI_CODE_HOME: kimiHome() } })
  }
  it('enables agents additively and refreshes without changing the project instructions or manifest again', async () => {
    const instructions = await readFile(join(project, 'AGENTS.md'), 'utf8')
    expect(instructions).toContain(GENERATED_INSTRUCTIONS)
    for (const agent of ['codex', 'kimi', 'claude-code']) {
      const result = run('enable', agent, '--scope', 'shared', '--json')
      expect(result.status).toBe(0)
      expect(JSON.parse(result.stdout).report.conflicts).toEqual([])
    }
    const inventory = JSON.parse(run('list', '--json').stdout)
    expect(inventory.configuredAgents.sort()).toEqual(['claude-code', 'codex', 'kimi'])
    expect(inventory.runtime).toBe('not-checked')
    const manifest = await readFile(join(project, '.saasfoundry.json'), 'utf8')
    expect(run('enable', 'codex', '--scope', 'shared').status).toBe(0)
    expect(run('refresh', '--scope', 'shared').status).toBe(0)
    expect(await readFile(join(project, '.saasfoundry.json'), 'utf8')).toBe(manifest)
    expect(await readFile(join(project, 'AGENTS.md'), 'utf8')).toBe(instructions)
    await expect(readFile(join(project, 'CLAUDE.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  // Every routed delegation is captured by a host hook (#1035): installing the harness and refreshing it
  // wire them into what the project already has, and a second refresh changes nothing.
  it('wires the delegation capture hooks of the declared hosts on a refresh, without touching the rest of the project settings', async () => {
    const settingsPath = join(project, '.claude/settings.json')
    const mine = JSON.stringify({ model: 'opus', hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } }, null, 2) + '\n'
    await writeFile(settingsPath, mine)
    for (const agent of ['claude-code', 'codex']) expect(run('enable', agent, '--scope', 'shared').status).toBe(0)
    // Enabling an agent never touches the host settings of the project; the Codex hooks file travels with its tier agents.
    expect(await readFile(settingsPath, 'utf8')).toBe(mine)
    expect(JSON.parse(await readFile(join(project, '.codex/hooks.json'), 'utf8')).hooks.SubagentStop).toHaveLength(1)
    expect(run('refresh', '--scope', 'shared').status).toBe(0)
    const settings = JSON.parse(await readFile(settingsPath, 'utf8'))
    expect(settings.model).toBe('opus')
    expect(settings.hooks.SessionStart[0].hooks[0].command).toBe('echo mine')
    expect(settings.hooks.SubagentStop.flatMap((group: { hooks: { command: string }[] }) => group.hooks.map((hook) => hook.command))).toEqual([CLAUDE_CAPTURE_COMMAND])
    expect(settings.hooks.SubagentStop[0].matcher).toBe('sf-.*')
    expect(settings.hooks.PostToolUse[0].matcher).toBe('Agent|Task')
    expect(settings.permissions.allow).toContain('Bash(sf agents route *)')
    expect(settings.permissions.allow).not.toContain('Bash(sf agents outcome mark *)')
    expect(settings.permissions.allow).not.toContain('Bash(sf agents outcome record *)')
    const codex = JSON.parse(await readFile(join(project, '.codex/hooks.json'), 'utf8'))
    expect(codex.hooks.SubagentStop[0].hooks[0].command).toBe(CODEX_CAPTURE_COMMAND)
    const settingsText = await readFile(settingsPath, 'utf8')
    const codexText = await readFile(join(project, '.codex/hooks.json'), 'utf8')
    const refreshed = run('refresh', '--scope', 'shared', '--json')
    expect(refreshed.status).toBe(0)
    expect(JSON.parse(refreshed.stdout).report.written).not.toEqual(expect.arrayContaining(['.claude/settings.json', '.codex/hooks.json']))
    expect(await readFile(settingsPath, 'utf8')).toBe(settingsText)
    expect(await readFile(join(project, '.codex/hooks.json'), 'utf8')).toBe(codexText)
  })

  it.each([
    ['enable', 'codex'],
    ['enable', 'gpt', '--scope', 'shared'],
    ['enable', 'codex', '--scope', 'local'],
    ['enable', 'codex', '--scope', 'shared', '--unknown']
  ])('rejects invalid input or local setup without Git before depositing files: %j', async (...args: string[]) => {
    const manifest = await readFile(join(project, '.saasfoundry.json'), 'utf8')
    const agentsInstructions = await readFile(join(project, 'AGENTS.md'), 'utf8')
    expect(run(...args).status).not.toBe(0)
    expect(await readFile(join(project, '.saasfoundry.json'), 'utf8')).toBe(manifest)
    expect(await readFile(join(project, 'AGENTS.md'), 'utf8')).toBe(agentsInstructions)
  })
  // #1301 (AC-1, AC-2): a Kimi Code session that names itself `kimi-code` is refused by every command, with the same hint, and nothing is accepted or written
  describe.each(['kimi-code', 'Kimi', 'kimi_code'])('refuses %s with a suggestion, in enable, replace, list and route', (name) => {
    const hint = `'${name}' is not a registered coding agent. Did you mean kimi?`
    it.each([['enable'], ['replace']])('%s exits non-zero, suggests kimi and leaves the project as it was', async (command) => {
      const manifest = await readFile(join(project, '.saasfoundry.json'), 'utf8')
      const text = run(command, name, '--scope', 'shared')
      expect(text.status).not.toBe(0)
      expect(text.stderr).toContain(hint)
      const json = run(command, name, '--scope', 'shared', '--json')
      expect(json.status).not.toBe(0)
      expect(JSON.parse(json.stdout).error).toContain(hint)
      expect(await readFile(join(project, '.saasfoundry.json'), 'utf8')).toBe(manifest)
    })
    it('list exits non-zero on a manifest that declares it, with the same hint, and never reads it as kimi', async () => {
      const manifest = JSON.stringify({ version: 'test', projectName: 'agents-demo', generatedAt: '2026-09-08', structure: 'cli', modules: { harness: { version: 4, agents: ['claude-code', name] } } })
      await writeFile(join(project, '.saasfoundry.json'), manifest)
      const result = run('list', '--json')
      expect(result.status).not.toBe(0)
      expect(JSON.parse(result.stdout).error).toContain(hint)
      expect(await readFile(join(project, '.saasfoundry.json'), 'utf8')).toBe(manifest)
    })
    it('route exits non-zero with the same hint and routes nothing', () => {
      const result = run('route', '--task', 'bug-fix', '--provider', name)
      expect(result.status).not.toBe(0)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain(`${hint} Routed coding agents: claude-code, codex, kimi.`)
    })
  })
  it('gives a name with no close match no suggestion in enable, replace and route', () => {
    for (const args of [
      ['enable', 'moonshot'],
      ['replace', 'moonshot'],
      ['route', '--task', 'bug-fix', '--provider', 'moonshot']
    ]) {
      const result = run(...args)
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain("'moonshot' is not a registered coding agent.")
      expect(result.stderr).not.toContain('Did you mean')
    }
  })
  it('never rewrites a user-authored AGENTS.md without a generated region when enabling an agent', async () => {
    await writeFile(join(project, 'AGENTS.md'), '# Personal agent instructions\n')
    const result = run('enable', 'codex', '--scope', 'shared', '--json')
    expect(result.status).toBe(0)
    const report = JSON.parse(result.stdout)
    expect(report.report.conflicts).toEqual([])
    expect(report.configuredAgents).toContain('codex')
    expect(await readFile(join(project, 'AGENTS.md'), 'utf8')).toBe('# Personal agent instructions\n')
    await expect(readFile(join(project, 'AGENTS.md.saasfoundry.new'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  function succeeds(...args: string[]) {
    const result = run(...args)
    if (result.status !== 0) throw new Error(`sf agents ${args.join(' ')} failed: ${result.stderr}${result.stdout}`)
    return result
  }
  function git(...args: string[]): string {
    return execFileSync('git', args, { cwd: project, encoding: 'utf8' }).trim()
  }
  function initializeGit() {
    git('init', '-q')
    git('add', '.')
    git('-c', 'user.name=Agent tests', '-c', 'user.email=agents@example.test', 'commit', '-qm', 'Initial harness')
  }
  it('defaults to local, keeps the tracked tree clean, and exposes shared promotion in Git', async () => {
    initializeGit()
    const manifest = await readFile(join(project, '.saasfoundry.json'), 'utf8')
    const branch = git('symbolic-ref', 'HEAD')
    const result = succeeds('enable', 'codex', '--json')
    expect(result.status).toBe(0)
    const inventory = JSON.parse(run('list', '--json').stdout)
    expect(inventory.localAgents).toContain('codex')
    expect(inventory.sharedAgents).toEqual(['claude-code'])
    expect(git('status', '--porcelain')).toBe('')
    expect(git('diff', '--cached')).toBe('')
    expect(await readFile(join(project, '.saasfoundry.json'), 'utf8')).toBe(manifest)
    expect(git('symbolic-ref', 'HEAD')).toBe(branch)
    expect(run('refresh').status).toBe(0)
    expect(run('enable', 'codex', '--scope', 'shared').status).toBe(0)
    expect(git('status', '--porcelain', '--untracked-files=all')).toContain('.agents/skills/')
    expect(git('status', '--porcelain', '--untracked-files=all')).toContain('.saasfoundry.json')
    expect(JSON.parse(run('list', '--json').stdout).sharedAgents).toContain('codex')
    git('add', '.')
    git('-c', 'user.name=Agent tests', '-c', 'user.email=agents@example.test', 'commit', '-qm', 'Share agent support')
    const clone = project + '-clone'
    try {
      git('clone', '-q', project, clone)
      const cloned = spawnSync(process.execPath, [join(ROOT, 'bin/sf.js'), 'agents', 'list', '--json'], { cwd: clone, encoding: 'utf8' })
      expect(cloned.status).toBe(0)
      expect(JSON.parse(cloned.stdout).sharedAgents).toContain('codex')
      expect(JSON.parse(cloned.stdout).localAgents).toEqual([])
      expect(await readFile(join(clone, 'AGENTS.md'), 'utf8')).toContain(GENERATED_INSTRUCTIONS)
    } finally {
      await rm(clone, { recursive: true, force: true })
    }
  })
  it('replaces the local declaration while preserving private adapter artifacts', async () => {
    initializeGit()
    expect(run('enable', 'gemini-cli', '--json').status).toBe(0)

    const result = run('replace', 'codex', '--json')

    expect(result.status).toBe(0)
    const inventory = JSON.parse(run('list', '--json').stdout)
    expect(inventory.localAgents).toEqual(['codex'])
    expect(inventory.configuredAgents).toEqual(['claude-code', 'codex'])
    expect(git('status', '--porcelain')).toBe('')
    expect(run('refresh').status).toBe(0)
    expect(git('status', '--porcelain')).toBe('')
  })
  it('replaces the shared declaration without deleting prior generated adapters', async () => {
    expect(run('enable', 'gemini-cli', '--scope', 'shared').status).toBe(0)
    const gemini = await readFile(join(project, 'GEMINI.md'), 'utf8')

    const result = run('replace', 'kimi', '--scope', 'shared', '--json')

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout).sharedAgents).toEqual(['kimi'])
    expect(JSON.parse(await readFile(join(project, '.saasfoundry.json'), 'utf8')).modules.harness.agents).toEqual(['kimi'])
    expect(await readFile(join(project, 'GEMINI.md'), 'utf8')).toBe(gemini)
  })
  it('enables locally without touching a tracked user-authored AGENTS.md or any tracked file', async () => {
    await writeFile(join(project, 'AGENTS.md'), '# Team rules\n')
    initializeGit()
    const manifest = await readFile(join(project, '.saasfoundry.json'), 'utf8')
    expect(succeeds('enable', 'codex').status).toBe(0)
    expect(git('status', '--porcelain', '--untracked-files=all')).toBe('')
    expect(await readFile(join(project, 'AGENTS.md'), 'utf8')).toBe('# Team rules\n')
    expect(await readFile(join(project, '.saasfoundry.json'), 'utf8')).toBe(manifest)
  })
  it('isolates local choices and exclusions between linked worktrees', async () => {
    initializeGit()
    const sibling = project + '-sibling'
    try {
      git('worktree', 'add', '-qb', 'sibling', sibling)
      succeeds('enable', 'codex')
      const siblingInventory = spawnSync(process.execPath, [join(ROOT, 'bin/sf.js'), 'agents', 'list', '--json'], { cwd: sibling, encoding: 'utf8' })
      expect(siblingInventory.status).toBe(0)
      expect(JSON.parse(siblingInventory.stdout).localAgents).toEqual([])
      await writeFile(join(sibling, 'AGENTS.md'), '# Unrelated sibling instructions\n')
      expect(execFileSync('git', ['status', '--porcelain'], { cwd: sibling, encoding: 'utf8' })).toContain('AGENTS.md')
      expect(git('status', '--porcelain')).toBe('')
    } finally {
      git('worktree', 'remove', '--force', sibling)
    }
  })
  describe('Kimi Code tier agents (FR-MAH-022)', () => {
    const TIERS = ['build', 'edit', 'fix', 'light', 'plan', 'terminal']
    const KIMI_FILES = TIERS.map((tier) => `.kimi-code/agents/sf-${tier}.md`)
    afterEach(async () => rm(kimiHome(), { recursive: true, force: true }))

    // AC-1
    it('writes .kimi-code/agents/sf-<tier>.md for every tier on a shared enable and a shared refresh, records them in the manifest, and leaves the other hosts alone', async () => {
      expect(run('enable', 'claude-code', 'codex', '--scope', 'shared').status).toBe(0)
      const claude = await Promise.all(TIERS.map((tier) => readFile(join(project, `.claude/agents/sf-${tier}.md`), 'utf8')))
      const codex = await Promise.all(TIERS.map((tier) => readFile(join(project, `.codex/agents/sf-${tier}.toml`), 'utf8')))
      const enabled = run('enable', 'kimi', '--scope', 'shared', '--json')
      expect(enabled.status).toBe(0)
      expect(
        JSON.parse(enabled.stdout)
          .report.written.filter((path: string) => path.startsWith('.kimi-code/'))
          .sort()
      ).toEqual(KIMI_FILES)
      const refreshed = run('refresh', '--scope', 'shared', '--json')
      expect(refreshed.status).toBe(0)
      expect(JSON.parse(refreshed.stdout).report.conflicts).toEqual([])
      const hashes = JSON.parse(await readFile(join(project, '.saasfoundry.json'), 'utf8')).fileHashes as Record<string, string>
      for (const path of KIMI_FILES) {
        expect(hashes[path]).toMatch(/^[0-9a-f]{64}$/)
        expect(await readFile(join(project, path), 'utf8')).toContain('${base_prompt}')
      }
      // the Claude Code and Codex files are the ones they were
      expect(await Promise.all(TIERS.map((tier) => readFile(join(project, `.claude/agents/sf-${tier}.md`), 'utf8')))).toEqual(claude)
      expect(await Promise.all(TIERS.map((tier) => readFile(join(project, `.codex/agents/sf-${tier}.toml`), 'utf8')))).toEqual(codex)
    })

    it('is idempotent: a second shared refresh writes nothing and changes neither the manifest nor the files', async () => {
      expect(run('enable', 'kimi', '--scope', 'shared').status).toBe(0)
      const manifest = await readFile(join(project, '.saasfoundry.json'), 'utf8')
      const files = await Promise.all(KIMI_FILES.map((path) => readFile(join(project, path), 'utf8')))
      const again = JSON.parse(run('refresh', '--scope', 'shared', '--json').stdout)
      expect(again.report.written.filter((path: string) => path.startsWith('.kimi-code/'))).toEqual([])
      expect(again.report.unchanged).toEqual(expect.arrayContaining(KIMI_FILES))
      expect(await readFile(join(project, '.saasfoundry.json'), 'utf8')).toBe(manifest)
      expect(await Promise.all(KIMI_FILES.map((path) => readFile(join(project, path), 'utf8')))).toEqual(files)
    })

    it('keeps an edited Kimi tier agent and writes a .saasfoundry.new sidecar of the render', async () => {
      expect(run('enable', 'kimi', '--scope', 'shared').status).toBe(0)
      const rendered = await readFile(join(project, '.kimi-code/agents/sf-fix.md'), 'utf8')
      await writeFile(join(project, '.kimi-code/agents/sf-fix.md'), rendered.replace('name: sf-fix', 'name: sf-fix # mine'))
      const result = run('refresh', '--scope', 'shared', '--json')
      expect(result.status).toBe(1)
      expect(JSON.parse(result.stdout).report.conflicts).toEqual(['.kimi-code/agents/sf-fix.md'])
      expect(await readFile(join(project, '.kimi-code/agents/sf-fix.md'), 'utf8')).toContain('# mine')
      expect(await readFile(join(project, '.kimi-code/agents/sf-fix.md.saasfoundry.new'), 'utf8')).toBe(rendered)
    })

    // AC-2
    it('writes no tracked file on a local enable, and leaves the manifest and the Git index as they were', async () => {
      initializeGit()
      const manifest = await readFile(join(project, '.saasfoundry.json'), 'utf8')
      const index = git('ls-files', '--stage')
      const result = succeeds('enable', 'kimi', '--json')
      expect(
        JSON.parse(result.stdout)
          .report.written.filter((path: string) => path.startsWith('.kimi-code/'))
          .sort()
      ).toEqual(KIMI_FILES)
      for (const path of KIMI_FILES) expect(await readFile(join(project, path), 'utf8')).toContain('name: sf-')
      expect(git('status', '--porcelain', '--untracked-files=all')).toBe('')
      expect(git('ls-files', '--stage')).toBe(index)
      expect(await readFile(join(project, '.saasfoundry.json'), 'utf8')).toBe(manifest)
      expect(succeeds('refresh').status).toBe(0)
      expect(git('status', '--porcelain', '--untracked-files=all')).toBe('')
    })

    // AC-3: the config is read, never written, and what is missing comes back as a warning that carries the TOML
    it('warns, with the TOML to paste, about the aliases the pool lacks, and never writes the Kimi Code configuration', async () => {
      const pool = `[models.sf-k3-low]\nprovider = "managed:kimi-code"\nmodel = "k3"\nmax_context_size = 1048576\napi_key = "sk-do-not-print"\n\n[secondary_model.models]\nsf-k3-low = "A"\n`
      await mkdir(kimiHome(), { recursive: true })
      await writeFile(join(kimiHome(), 'config.toml'), pool)
      const result = run('enable', 'kimi', '--scope', 'shared')
      expect(result.status).toBe(0)
      expect(result.stderr).toContain(`Kimi Code model aliases of the sf-<tier> agents to declare in ${join(kimiHome(), 'config.toml')}: sf-k3-high, sf-k3-1-pro-high, sf-k3-1-pro-max.`)
      expect(result.stderr).toContain('[models.sf-k3-high]\nprovider = "managed:kimi-code"\nmodel = "k3"\nmax_context_size = 1048576')
      expect(result.stderr).toContain('[models.sf-k3-1-pro-high]\nprovider = "<provider of your k3.1-pro entry>"')
      expect(result.stderr).toContain('Add these lines under your existing [secondary_model.models] table; do not repeat its header.')
      expect(result.stderr).not.toContain('sf-k3-low =')
      expect(result.stderr).not.toContain('sk-do-not-print')
      expect(await readFile(join(kimiHome(), 'config.toml'), 'utf8')).toBe(pool)
      // a refresh says it again while the pool lacks the aliases, in the JSON report too
      const json = JSON.parse(run('refresh', '--scope', 'shared', '--json').stdout)
      expect(json.report.warnings.some((warning: string) => warning.includes('[models.sf-k3-1-pro-max]'))).toBe(true)
      expect(await readFile(join(kimiHome(), 'config.toml'), 'utf8')).toBe(pool)
    })

    it('stays quiet about aliases once the pool declares every one', async () => {
      const aliases = ['sf-k3-low', 'sf-k3-high', 'sf-k3-1-pro-high', 'sf-k3-1-pro-max']
      await mkdir(kimiHome(), { recursive: true })
      await writeFile(join(kimiHome(), 'config.toml'), `[secondary_model.models]\n${aliases.map((alias) => `${alias} = "x"`).join('\n')}\n`)
      const result = run('enable', 'kimi', '--scope', 'shared')
      expect(result.status).toBe(0)
      expect(result.stderr).not.toContain('model aliases')
      expect(result.stderr).not.toContain('[models.')
    })

    it('says nothing about Kimi Code aliases when kimi is not declared, and does not read the configuration', async () => {
      await mkdir(join(kimiHome(), 'config.toml'), { recursive: true })
      const result = run('enable', 'codex', '--scope', 'shared')
      expect(result.status).toBe(0)
      expect(result.stderr).not.toContain('Kimi Code model aliases')
      expect(result.stderr).not.toContain('could not be read')
    })

    it('says it could not read the configuration, and still gives the TOML, without failing the setup', async () => {
      await mkdir(join(kimiHome(), 'config.toml'), { recursive: true })
      const result = run('enable', 'kimi', '--scope', 'shared')
      expect(result.status).toBe(0)
      expect(result.stderr).toContain('could not be read (it is not a regular file)')
      expect(result.stderr).toContain('[models.sf-k3-low]')
    })
  })

  it('lists the versioned catalog without requiring a managed project or writing files', async () => {
    const agentsInstructions = await readFile(join(project, 'AGENTS.md'), 'utf8')
    await rm(join(project, '.saasfoundry.json'))
    const result = run('catalog', '--json')
    expect(result.status).toBe(0)
    const catalog = JSON.parse(result.stdout)
    expect(catalog.registryVersion).toBe(1)
    expect(catalog.runtime).toBe('not-checked')
    expect(catalog.profiles.map((profile: { id: string }) => profile.id)).toEqual(expect.arrayContaining(['gemini-cli', 'qwen-code', 'generic']))
    expect(catalog.profiles.every((profile: { runtime: string }) => profile.runtime === 'not-checked')).toBe(true)
    expect(await readFile(join(project, 'AGENTS.md'), 'utf8')).toBe(agentsInstructions)
  })
  it('enables registry profiles without coupling instructions to a model or provider', async () => {
    for (const agent of ['gemini-cli', 'qwen-code', 'generic']) {
      const result = run('enable', agent, '--scope', 'shared', '--json')
      if (result.status !== 0) throw new Error(result.stdout + result.stderr)
    }
    expect(await readFile(join(project, 'GEMINI.md'), 'utf8')).toBe('# SaaSFoundry shared instructions\n\n@AGENTS.md\n')
    const before = await readFile(join(project, '.saasfoundry.json'), 'utf8')
    expect(JSON.parse(run('list', '--json').stdout).configuredAgents).toEqual(expect.arrayContaining(['claude-code', 'gemini-cli', 'qwen-code', 'generic']))
    expect(run('refresh', '--scope', 'shared').status).toBe(0)
    expect(await readFile(join(project, '.saasfoundry.json'), 'utf8')).toBe(before)
    expect(run('enable', 'deepseek', '--scope', 'shared').status).not.toBe(0)
    expect(await readFile(join(project, '.saasfoundry.json'), 'utf8')).toBe(before)
  })
})
