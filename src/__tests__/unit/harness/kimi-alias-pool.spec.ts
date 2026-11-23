import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { aliasAdvice, aliasSpecs, aliasStatus, kimiConfigPath, readAliasPool, scanAliasPool, type AliasPool } from '../../../harness/kimi-alias-pool'
import type { RoutingOverrides } from '../../../harness/routing-grid'

/** A config the way a developer who ran /login and declared a pool writes it. */
const CONFIG = `# my Kimi Code configuration
default_model = "kimi-code/k3"

[providers."managed:kimi-code"]
type = "kimi"
api_key = "sk-do-not-leak"
base_url = "https://api.example.com/v1"

[providers.other]
type = "openai"
api_key_env = "OTHER_KEY"

[models."kimi-code/k3"]
provider = "managed:kimi-code"
model = "k3"
max_context_size = 1_048_576
capabilities = [
  "thinking",
  "always_thinking",
  "tool_use",
]
support_efforts = ["low", "high", "max"]

[models.sf-k3-1-pro-high]
provider = "managed:kimi-code"
model = "k3.1-pro"
max_context_size = 2000000
capabilities = ["thinking", "tool_use"]

[models.sf-k3-1-pro-high.overrides]
default_effort = "high"

[secondary_model]
default_model = "kimi-code/k3"

[secondary_model.models]
"kimi-code/k3" = "Default high effort."
sf-k3-1-pro-high = "SaaSFoundry build tier."
`

describe('the Kimi Code alias pool, read and never written (FR-MAH-022)', () => {
  let home: string
  const config = () => join(home, 'config.toml')

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'sf-kimi-home-'))
  })
  afterEach(async () => {
    await rm(home, { recursive: true, force: true })
  })

  describe('where the configuration is read', () => {
    it('is $KIMI_CODE_HOME/config.toml when the variable is set, and ~/.kimi-code/config.toml otherwise', () => {
      expect(kimiConfigPath({ KIMI_CODE_HOME: '/tmp/kimi' }, '/home/dev')).toEqual({ path: '/tmp/kimi/config.toml', label: '/tmp/kimi/config.toml' })
      expect(kimiConfigPath({}, '/home/dev')).toEqual({ path: '/home/dev/.kimi-code/config.toml', label: '~/.kimi-code/config.toml' })
      expect(kimiConfigPath({ KIMI_CODE_HOME: '  ' }, '/home/dev').path).toBe('/home/dev/.kimi-code/config.toml')
    })

    it('reads the one KIMI_CODE_HOME names, and never the real home when it is set', async () => {
      await writeFile(config(), CONFIG)
      const pool = await readAliasPool({ KIMI_CODE_HOME: home }, '/nonexistent-home')
      expect(pool.state).toBe('present')
      expect(pool.source).toBe(config())
    })

    it('reads ~/.kimi-code/config.toml of the home it is given when the variable is unset', async () => {
      await mkdir(join(home, '.kimi-code'))
      await writeFile(join(home, '.kimi-code', 'config.toml'), CONFIG)
      expect((await readAliasPool({}, home)).state).toBe('present')
    })
  })

  describe('the state of the pool', () => {
    it('is present, with its keys, when the config has a [secondary_model.models] table', async () => {
      await writeFile(config(), CONFIG)
      const pool = await readAliasPool({ KIMI_CODE_HOME: home })
      expect(pool).toMatchObject({ state: 'present', keys: ['kimi-code/k3', 'sf-k3-1-pro-high'], hasSecondaryModel: true, defaultEffort: false })
      expect(aliasStatus(pool, 'sf-k3-1-pro-high')).toBe('present')
      expect(aliasStatus(pool, 'sf-k3-low')).toBe('missing')
    })

    it('is missing when the config has no pool, and when there is no config at all', async () => {
      await writeFile(config(), '[models.k3]\nprovider = "p"\nmodel = "k3"\n')
      const without = await readAliasPool({ KIMI_CODE_HOME: home })
      expect(without).toMatchObject({ state: 'missing', keys: [], hasSecondaryModel: false })
      expect(aliasStatus(without, 'sf-k3-low')).toBe('missing')
      await rm(config())
      expect(await readAliasPool({ KIMI_CODE_HOME: home })).toMatchObject({ state: 'missing', keys: [], models: {} })
    })

    it('is present for an empty [secondary_model.models] table, with no key', () => {
      expect(scanAliasPool('[secondary_model]\ndefault_model = "x"\n[secondary_model.models]\n', 'c')).toMatchObject({ state: 'present', keys: [], hasSecondaryModel: true })
    })

    it('reads a pool written with dotted keys, and one under a [secondary_model] table', () => {
      const pool = scanAliasPool('[secondary_model]\ndefault_model = "x"\nmodels.sf-a-low = "A"\nmodels."sf-b-high" = "B"\n', 'c')
      expect(pool).toMatchObject({ state: 'present', keys: ['sf-a-low', 'sf-b-high'] })
    })

    it('is unknown when the config cannot be read, and says why', async () => {
      await mkdir(config())
      expect(await readAliasPool({ KIMI_CODE_HOME: home })).toMatchObject({ state: 'unknown', reason: 'it is not a regular file', keys: [] })
      await rm(config(), { recursive: true })
      await writeFile(config(), Buffer.from([0xff, 0xfe, 0x00, 0x61]))
      expect(await readAliasPool({ KIMI_CODE_HOME: home })).toMatchObject({ state: 'unknown', reason: 'it is not UTF-8 text' })
      await writeFile(config(), 'x'.repeat(1024 * 1024 + 1))
      expect(await readAliasPool({ KIMI_CODE_HOME: home })).toMatchObject({ state: 'unknown', reason: 'it is larger than 1 MiB' })
    })

    it('is unknown for a pool it cannot place, an inline table, instead of guessing', () => {
      const pool = scanAliasPool('[secondary_model]\nmodels = { a = "A" }\n', 'c')
      expect(pool).toMatchObject({ state: 'unknown', keys: [] })
      expect(pool.reason).toContain('inline table')
    })

    it('follows a configuration it reaches through a link, read-only', async () => {
      const real = join(home, 'real.toml')
      await writeFile(real, CONFIG)
      await symlink(real, config())
      expect((await readAliasPool({ KIMI_CODE_HOME: home })).state).toBe('present')
    })
  })

  describe('what is read of the configuration', () => {
    it('returns no secret: not an api_key, not a base URL, not an environment variable name', async () => {
      await writeFile(config(), CONFIG)
      const serialized = JSON.stringify(await readAliasPool({ KIMI_CODE_HOME: home }))
      for (const secret of ['sk-do-not-leak', 'api.example.com', 'OTHER_KEY', 'api_key']) expect(serialized).not.toContain(secret)
    })

    it('keeps from a [models.*] entry the provider, the model, the context size and the capabilities, whatever the layout', async () => {
      await writeFile(config(), CONFIG)
      const { models } = await readAliasPool({ KIMI_CODE_HOME: home })
      expect(models['kimi-code/k3']).toEqual({ provider: 'managed:kimi-code', model: 'k3', maxContextSize: 1048576, capabilities: ['thinking', 'always_thinking', 'tool_use'] })
      expect(models['sf-k3-1-pro-high']).toEqual({ provider: 'managed:kimi-code', model: 'k3.1-pro', maxContextSize: 2000000, capabilities: ['thinking', 'tool_use'] })
    })

    it('does not take a value inside a multi-line string for a table or a key', () => {
      const pool = scanAliasPool('note = """\n[secondary_model.models]\nsf-fake-high = "x"\n"""\nother = \'\'\'\n[models.fake]\n\'\'\'\n', 'c')
      expect(pool).toMatchObject({ state: 'missing', keys: [], hasSecondaryModel: false })
      expect(pool.models).toEqual({})
    })

    it('does not take a key of another table for a pool key, and ignores array tables', () => {
      const pool = scanAliasPool('[[plugins]]\nname = "x"\n\n[providers.p]\nsf-x-low = "no"\n\n[secondary_model.models]\nsf-ok-low = "yes" # a comment\n', 'c')
      expect(pool.keys).toEqual(['sf-ok-low'])
    })

    it('treats a name like __proto__ as a name, never as a prototype', () => {
      const pool = scanAliasPool('[models.__proto__]\nprovider = "p"\n[models.constructor]\nmodel = "m"\n', 'c')
      expect(Object.keys(pool.models).sort()).toEqual(['__proto__', 'constructor'])
      expect(({} as Record<string, unknown>).provider).toBeUndefined()
    })

    it('notes that [secondary_model].default_effort is set', () => {
      expect(scanAliasPool('[secondary_model]\ndefault_effort = "high"\ndefault_model = "x"\n', 'c').defaultEffort).toBe(true)
      expect(scanAliasPool('[secondary_model]\ndefault_model = "x"\n', 'c').defaultEffort).toBe(false)
      expect(scanAliasPool('[models.a]\ndefault_effort = "high"\n', 'c').defaultEffort).toBe(false)
    })
  })

  it('never writes the file: its bytes and its modification time are the same after a read, a route and a snippet', async () => {
    await writeFile(config(), CONFIG)
    const before = { bytes: await readFile(config()), mtime: (await stat(config())).mtimeMs }
    const pool = await readAliasPool({ KIMI_CODE_HOME: home })
    aliasAdvice(pool, aliasSpecs())
    expect(await readFile(config())).toEqual(before.bytes)
    expect((await stat(config())).mtimeMs).toBe(before.mtime)
  })
})

describe('the aliases a project needs (FR-MAH-022)', () => {
  it('has one per candidate of the shipped grid, shared by the tiers on the same candidate', () => {
    expect(aliasSpecs()).toEqual([
      { alias: 'sf-k3-low', model: 'k3', effort: 'low', tiers: ['light'] },
      { alias: 'sf-k3-high', model: 'k3', effort: 'high', tiers: ['edit'] },
      { alias: 'sf-k3-1-pro-high', model: 'k3.1-pro', effort: 'high', tiers: ['build', 'fix', 'plan'] },
      { alias: 'sf-k3-1-pro-max', model: 'k3.1-pro', effort: 'max', tiers: ['terminal'] }
    ])
  })

  it('follows the tiers the project overrides', () => {
    const overrides: RoutingOverrides = { tiers: { light: { kimi: { model: 'k3.2', effort: 'high' } } } }
    expect(aliasSpecs(overrides)[0]).toEqual({ alias: 'sf-k3-2-high', model: 'k3.2', effort: 'high', tiers: ['light'] })
  })

  it('refuses two candidates that give one alias, which would be one key of one pool', () => {
    const overrides: RoutingOverrides = { tiers: { light: { kimi: { model: 'k3-1-pro', effort: 'high' } } } }
    expect(() => aliasSpecs(overrides)).toThrow(/both give the alias sf-k3-1-pro-high/)
  })
})

describe('the snippet the developer pastes (FR-MAH-022)', () => {
  const pool = (state: Partial<AliasPool> = {}): AliasPool => ({ state: 'missing', source: '~/.kimi-code/config.toml', keys: [], hasSecondaryModel: false, defaultEffort: false, models: {}, ...state })
  const specs = aliasSpecs()

  it('says nothing when every alias is declared', () => {
    const advice = aliasAdvice(pool({ state: 'present', keys: specs.map((spec) => spec.alias) }), specs)
    expect(advice).toEqual({ needed: [], warnings: [] })
  })

  it('gives, for a present pool, the model entries first and then the lines under the existing table, never a second header', () => {
    const advice = aliasAdvice(pool({ state: 'present', keys: ['sf-k3-low', 'sf-k3-high'], hasSecondaryModel: true }), specs)
    expect(advice.needed.map((spec) => spec.alias)).toEqual(['sf-k3-1-pro-high', 'sf-k3-1-pro-max'])
    const snippet = advice.snippet!
    expect(snippet).not.toContain('[secondary_model.models]\n')
    expect(snippet).not.toMatch(/^\[secondary_model/m)
    expect(snippet.indexOf('[models.sf-k3-1-pro-high]')).toBeLessThan(snippet.indexOf('sf-k3-1-pro-high = '))
    expect(snippet).toContain('# 2. Add these lines under your existing [secondary_model.models] table; do not repeat its header.')
    expect(snippet).toContain('sf-k3-1-pro-high = "SaaSFoundry build, fix and plan tiers: k3.1-pro at high effort."')
    expect(snippet).toContain('sf-k3-1-pro-max = "SaaSFoundry terminal tier: k3.1-pro at max effort."')
    // an alias that is declared is not asked for again
    expect(snippet).not.toContain('sf-k3-low')
    expect(snippet).not.toContain('sf-k3-high')
  })

  it('writes each model entry with its effort, the efforts the host can express and no dot in the alias', () => {
    const snippet = aliasAdvice(pool(), specs).snippet!
    expect(snippet).toContain('[models.sf-k3-1-pro-high]\nprovider = "<provider of your k3.1-pro entry>"\nmodel = "k3.1-pro"\nmax_context_size = <max_context_size of your k3.1-pro entry>')
    expect(snippet).toContain('support_efforts = ["low", "high", "max"]\n\n[models.sf-k3-1-pro-high.overrides]\ndefault_effort = "high"')
    expect(snippet).toContain('[models.sf-k3-low.overrides]\ndefault_effort = "low"')
    expect(snippet).toContain('[models.sf-k3-1-pro-max.overrides]\ndefault_effort = "max"')
    expect(snippet.match(/^\[models\.[^\]]*\.[^\]]*\.overrides\]$/gm)).toBeNull()
  })

  it('copies the provider, the context size and the capabilities of the entry of the same model, and keeps explicit placeholders for the others', async () => {
    const config = scanAliasPool(CONFIG, 'c')
    const snippet = aliasAdvice({ ...config, keys: [] }, specs).snippet!
    const k3 = snippet.slice(snippet.indexOf('[models.sf-k3-low]'), snippet.indexOf('[models.sf-k3-low.overrides]'))
    expect(k3).toContain('provider = "managed:kimi-code"')
    expect(k3).toContain('max_context_size = 1048576')
    expect(k3).toContain('capabilities = ["thinking", "always_thinking", "tool_use"]')
    // the config declares sf-k3-1-pro-high already as an entry: only its pool line is missing
    expect(snippet).not.toContain('[models.sf-k3-1-pro-high]')
    expect(snippet).toContain('sf-k3-1-pro-high = ')
    expect(snippet).not.toContain('sk-do-not-leak')
    const fresh = aliasAdvice(pool(), specs).snippet!
    expect(fresh).toContain('# capabilities = [...]  # copy the capabilities of your k3 entry, if it has any')
  })

  it('opens [secondary_model] only when the config has none, and asks for a default_model that is a key of the pool', () => {
    const none = aliasAdvice(pool(), specs).snippet!
    expect(none).toContain('Your config has no [secondary_model.models] table yet.')
    expect(none).toContain('[secondary_model]\ndefault_model = "<the key of the model sub-agents use when no alias is passed>"\n\n[secondary_model.models]\nsf-k3-low = ')
    const some = aliasAdvice(pool({ hasSecondaryModel: true }), specs).snippet!
    expect(some).not.toMatch(/^\[secondary_model\]$/m)
    expect(some).toMatch(/^\[secondary_model\.models\]$/m)
  })

  it('tells that the pool could not be read, and gives the entries for every alias with both ways to add them', () => {
    const advice = aliasAdvice(pool({ state: 'unknown', reason: 'it cannot be read (EACCES)' }), specs)
    expect(advice.warnings).toEqual(['~/.kimi-code/config.toml could not be read (it cannot be read (EACCES)), so sf cannot tell which model aliases it declares.'])
    expect(advice.needed).toHaveLength(specs.length)
    expect(advice.snippet).toContain('If your config already has a [secondary_model.models] table, add the lines under it')
  })

  it('warns when [secondary_model].default_effort outranks the effort of every alias, even when every alias is declared', () => {
    const advice = aliasAdvice(pool({ state: 'present', keys: specs.map((spec) => spec.alias), defaultEffort: true }), specs)
    expect(advice.snippet).toBeUndefined()
    expect(advice.warnings).toHaveLength(1)
    expect(advice.warnings[0]).toContain('[secondary_model].default_effort is set, and it outranks the effort of every alias')
  })

  it('quotes nothing a developer could not paste: a snippet is valid TOML once the placeholders are filled', () => {
    const snippet = aliasAdvice(pool({ state: 'present', keys: [] }), specs).snippet!
    // every non-comment, non-blank line is a table header or a key = value
    for (const line of snippet.split('\n').filter((entry) => entry.trim() && !entry.startsWith('#'))) expect(line).toMatch(/^(?:\[[A-Za-z0-9_.-]+\]|[A-Za-z0-9_-]+ = .+)$/)
  })
})
