import { buildPrefillFromOptions, parseAgentsOption, NewCommandOptions } from '../../../commands/new.options'

describe('buildPrefillFromOptions', () => {
  it('returns an empty prefill when no options are provided', () => {
    expect(buildPrefillFromOptions({})).toEqual({})
  })

  it('maps simple project fields', () => {
    const prefill = buildPrefillFromOptions({
      projectName: 'acme',
      projectDescription: 'Great app',
      mainBranch: 'main'
    })

    expect(prefill).toMatchObject({
      projectName: 'acme',
      projectDescription: 'Great app',
      mainBranch: 'main'
    })
  })

  it('parses --agents as a trimmed, deduplicated registry selection', () => {
    expect(buildPrefillFromOptions({ agents: 'claude-code, codex, claude-code' }).agents).toEqual(['claude-code', 'codex'])
  })

  it('rejects empty and unknown --agents values', () => {
    expect(() => parseAgentsOption(' , ')).toThrow('requires at least one')
    expect(() => parseAgentsOption('claude-code,sonnet')).toThrow('Unknown coding agent')
  })

  it('converts --structure monorepo to isMonorepo=true', () => {
    expect(buildPrefillFromOptions({ structure: 'monorepo' }).isMonorepo).toBe(true)
    expect(buildPrefillFromOptions({ structure: 'multirepo' }).isMonorepo).toBe(false)
  })

  it('collects db fields into a nested dbCredentials object', () => {
    const prefill = buildPrefillFromOptions({
      dbType: 'postgresql',
      dbHost: 'localhost',
      dbPort: '5432',
      dbUser: 'postgres',
      dbPassword: 'secret',
      dbName: 'acme_db'
    })

    expect(prefill.dbCredentials).toEqual({
      dbType: 'postgresql',
      host: 'localhost',
      port: '5432',
      user: 'postgres',
      password: 'secret',
      database: 'acme_db'
    })
  })

  it('only includes db fields that were explicitly provided', () => {
    const prefill = buildPrefillFromOptions({ dbHost: 'localhost' })

    expect(prefill.dbCredentials).toEqual({ host: 'localhost' })
  })

  it('omits dbCredentials entirely when no db fields are provided', () => {
    const prefill = buildPrefillFromOptions({ projectName: 'acme' })

    expect(prefill.dbCredentials).toBeUndefined()
  })

  it('collects s3 fields into a nested s3Credentials object', () => {
    const prefill = buildPrefillFromOptions({
      s3Endpoint: 'http://localhost:9000',
      s3AccessKey: 'AKIA...',
      s3SecretKey: 'secret',
      s3Bucket: 'my-bucket',
      s3Region: 'eu-west-1'
    })

    expect(prefill.s3Credentials).toEqual({
      endpoint: 'http://localhost:9000',
      accessKey: 'AKIA...',
      secretKey: 'secret',
      bucket: 'my-bucket',
      region: 'eu-west-1'
    })
  })

  it('maps --analytics / --no-analytics to includeAnalytics', () => {
    expect(buildPrefillFromOptions({ analytics: true }).includeAnalytics).toBe(true)
    expect(buildPrefillFromOptions({ analytics: false }).includeAnalytics).toBe(false)
    expect(buildPrefillFromOptions({}).includeAnalytics).toBeUndefined()
  })

  it('parses advancedSkills CSV and trims whitespace', () => {
    const prefill = buildPrefillFromOptions({ advancedSkills: 'context7, atlassian ,  notion' })

    expect(prefill.advancedSkills).toEqual(['context7', 'atlassian', 'notion'])
  })

  it('filters out empty entries from the advancedSkills CSV', () => {
    const prefill = buildPrefillFromOptions({ advancedSkills: 'context7,,atlassian,' })

    expect(prefill.advancedSkills).toEqual(['context7', 'atlassian'])
  })

  it('maps skill credentials flags to their prefill keys', () => {
    const opts: NewCommandOptions = {
      atlassianEmail: 'a@b.c',
      atlassianApiToken: 'token',
      atlassianSite: 'acme',
      atlassianCloudId: 'cloud-1',
      notionApiToken: 'notion-tok',
      notionApiVersion: '2022-06-28',
      figmaApiToken: 'figma-tok',
      context7ApiKey: 'c7'
    }

    const prefill = buildPrefillFromOptions(opts)

    expect(prefill).toMatchObject({
      atlassianEmail: 'a@b.c',
      atlassianApiToken: 'token',
      atlassianSite: 'acme',
      atlassianCloudId: 'cloud-1',
      notionApiToken: 'notion-tok',
      notionApiVersion: '2022-06-28',
      figmaApiToken: 'figma-tok',
      context7ApiKey: 'c7'
    })
  })

  it('maps repo setup fields', () => {
    const prefill = buildPrefillFromOptions({
      setupRepo: 'existing',
      monorepoUrl: 'git@github.com:acme/repo.git',
      backendRepoUrl: 'git@github.com:acme/api.git',
      frontendRepoUrl: 'git@github.com:acme/web.git'
    })

    expect(prefill).toMatchObject({
      setupRepo: 'existing',
      monorepoUrl: 'git@github.com:acme/repo.git',
      backendRepoUrl: 'git@github.com:acme/api.git',
      frontendRepoUrl: 'git@github.com:acme/web.git'
    })
  })

  describe('tools-first flags', () => {
    it('maps --tracker / --docs into single selections', () => {
      const prefill = buildPrefillFromOptions({ tracker: 'github-projects', docs: 'notion' })
      expect(prefill.toolSelections).toEqual({ tracker: { name: 'github-projects' }, docs: { name: 'notion' } })
    })

    it('parses --design CSV into a list of selections, trimming and dropping blanks', () => {
      const prefill = buildPrefillFromOptions({ design: 'figma, ,miro,' })
      expect(prefill.toolSelections).toEqual({ design: [{ name: 'figma' }, { name: 'miro' }] })
    })

    it('maps --no-network (network=false) to toolsNoNetwork', () => {
      expect(buildPrefillFromOptions({ network: false }).toolsNoNetwork).toBe(true)
    })

    it('leaves the tools registry untouched when no tools flags are passed (byte-identical parity)', () => {
      const prefill = buildPrefillFromOptions({ projectName: 'acme', nonInteractive: true })
      expect(prefill.toolSelections).toBeUndefined()
      expect(prefill.toolsNoNetwork).toBeUndefined()
    })
  })

  describe('SRS + ingestion flags', () => {
    it('uses NOTION_API_TOKEN for non-interactive SRS setup without putting the token in argv', () => {
      const prefill = buildPrefillFromOptions({ nonInteractive: true, srsEnable: true, srsBackend: 'notion' }, { NOTION_API_TOKEN: 'secret_from_environment' })

      expect(prefill.notionApiToken).toBe('secret_from_environment')
    })

    it('lets an explicit token flag take precedence over the environment for compatibility', () => {
      const prefill = buildPrefillFromOptions({ nonInteractive: true, srsEnable: true, notionApiToken: 'explicit_token' }, { NOTION_API_TOKEN: 'environment_token' })

      expect(prefill.notionApiToken).toBe('explicit_token')
    })

    it('does not consume the environment token when SRS setup was not requested', () => {
      const prefill = buildPrefillFromOptions({ nonInteractive: true }, { NOTION_API_TOKEN: 'unrelated_token' })

      expect(prefill.notionApiToken).toBeUndefined()
    })

    it('maps --srs-enable / --srs-backend / --srs-parent-page-input to prefill', () => {
      const prefill = buildPrefillFromOptions({
        srsEnable: true,
        srsBackend: 'notion',
        srsParentPageInput: 'https://www.notion.so/Parent-abc123'
      })

      expect(prefill).toMatchObject({
        srsEnable: true,
        srsBackend: 'notion',
        srsParentPageInput: 'https://www.notion.so/Parent-abc123'
      })
    })

    it('maps --srs-ingest-enable / --srs-ingest-parent-input to prefill', () => {
      const prefill = buildPrefillFromOptions({
        srsIngestEnable: true,
        srsIngestParentInput: 'https://www.notion.so/Notes-parent'
      })

      expect(prefill).toMatchObject({
        srsIngestEnable: true,
        srsIngestParentInput: 'https://www.notion.so/Notes-parent'
      })
    })

    it('defaults srsEnable and srsIngestEnable to false in --non-interactive mode when not explicitly set', () => {
      const prefill = buildPrefillFromOptions({ nonInteractive: true })

      expect(prefill.srsEnable).toBe(false)
      expect(prefill.srsIngestEnable).toBe(false)
    })

    it('respects explicit --no-srs-enable / --no-srs-ingest-enable even outside non-interactive mode', () => {
      const prefill = buildPrefillFromOptions({ srsEnable: false, srsIngestEnable: false })

      expect(prefill.srsEnable).toBe(false)
      expect(prefill.srsIngestEnable).toBe(false)
    })

    it('leaves srsEnable / srsIngestEnable undefined when neither flag nor --non-interactive is set (interactive defaults preserved)', () => {
      const prefill = buildPrefillFromOptions({})

      expect(prefill.srsEnable).toBeUndefined()
      expect(prefill.srsIngestEnable).toBeUndefined()
    })
  })
})

describe('buildPrefillFromOptions — output language', () => {
  it('maps --language onto the prefill', () => {
    expect(buildPrefillFromOptions({ language: 'fr' }).outputLanguage).toBe('fr')
  })

  // The config session throws on an unfilled field rather than applying the step
  // default, so a scripted `sf new` would otherwise be forced to pass --language
  // just to get the documented English default. Same pattern as `pwa`.
  it('materialises English in --non-interactive so no flag is needed for the default', () => {
    expect(buildPrefillFromOptions({ nonInteractive: true }).outputLanguage).toBe('en')
  })

  it('lets an explicit --language win over the non-interactive default', () => {
    expect(buildPrefillFromOptions({ nonInteractive: true, language: 'pt-BR' }).outputLanguage).toBe('pt-BR')
  })

  it('leaves outputLanguage undefined interactively, so the step still asks', () => {
    expect(buildPrefillFromOptions({}).outputLanguage).toBeUndefined()
  })

  // #895 — an unknown preset produced a project with no workflow and no error
  describe('--workflow', () => {
    it.each(['solo', 'saasfoundry'] as const)('preselects the %s preset', (preset) => {
      expect(buildPrefillFromOptions({ workflow: preset }).workflowPreset).toBe(preset)
    })

    it.each(['sollo', 'team'])('refuses %p before any question, listing the valid values', (value) => {
      expect(() => buildPrefillFromOptions({ workflow: value })).toThrow('Expected one of: solo, saasfoundry, none.')
      expect(() => buildPrefillFromOptions({ nonInteractive: true, workflow: value })).toThrow(`Invalid --workflow "${value}"`)
    })
  })

  // #896 — --no-workflow / --workflow none were read by nothing, so the step still asked
  describe('--no-workflow', () => {
    it.each([false, 'none'] as const)('marks the workflow disabled for %p, interactive or not', (workflow) => {
      expect(buildPrefillFromOptions({ workflow }).workflowDisabled).toBe(true)
      expect(buildPrefillFromOptions({ nonInteractive: true, workflow }).workflowDisabled).toBe(true)
    })

    it('leaves the workflow enabled without the flag or with a preset', () => {
      expect(buildPrefillFromOptions({})).not.toHaveProperty('workflowDisabled')
      expect(buildPrefillFromOptions({ workflow: 'solo' })).not.toHaveProperty('workflowDisabled')
    })

    it('refuses a workflow flag it would drop', () => {
      expect(() => buildPrefillFromOptions({ workflow: false, createBoard: true })).toThrow('--create-board configures a workflow, which --no-workflow skips')
      expect(() => buildPrefillFromOptions({ workflow: 'none', workingBranch: 'main' })).toThrow('--working-branch configures a workflow')
    })
  })

  // #822 — the non-interactive path had no branch flags and always wrote develop
  describe('--working-branch / --pr-target-branch', () => {
    it('maps the branch flags into workflowBranches', () => {
      expect(buildPrefillFromOptions({ nonInteractive: true, workflow: 'solo', workingBranch: 'main' }).workflowBranches).toEqual({ workingBranch: 'main' })
      expect(buildPrefillFromOptions({ workingBranch: 'trunk', prTargetBranch: 'release/next' }).workflowBranches).toEqual({ workingBranch: 'trunk', prTargetBranch: 'release/next' })
    })

    it('leaves workflowBranches unset without the flags', () => {
      expect(buildPrefillFromOptions({ nonInteractive: true, workflow: 'solo' })).not.toHaveProperty('workflowBranches')
    })

    it('rejects a name Git refuses, before it reaches a git command', () => {
      expect(() => buildPrefillFromOptions({ workingBranch: 'main;touch pwned' })).toThrow('--working-branch: invalid Git branch name')
      expect(() => buildPrefillFromOptions({ prTargetBranch: 'bad..name' })).toThrow('--pr-target-branch: invalid Git branch name')
    })

    it('refuses the flags non-interactively without a workflow preset, which would drop them', () => {
      expect(() => buildPrefillFromOptions({ nonInteractive: true, workingBranch: 'main' })).toThrow('pass --workflow solo or --workflow saasfoundry')
    })
  })

  // #821 — a non-interactive setup had no way to attach or create its board
  describe('--project-url / --create-board', () => {
    it('maps either flag into workflowBoard', () => {
      expect(buildPrefillFromOptions({ nonInteractive: true, workflow: 'solo', projectUrl: 'https://github.com/users/octo/projects/1' }).workflowBoard).toEqual({
        projectUrl: 'https://github.com/users/octo/projects/1'
      })
      expect(buildPrefillFromOptions({ nonInteractive: true, workflow: 'solo', createBoard: true }).workflowBoard).toEqual({ create: true })
    })

    it('refuses both at once, either without a preset non-interactively, and --create-board for another tracker', () => {
      expect(() => buildPrefillFromOptions({ workflow: 'solo', projectUrl: 'https://github.com/users/octo/projects/1', createBoard: true })).toThrow('are exclusive')
      expect(() => buildPrefillFromOptions({ nonInteractive: true, createBoard: true })).toThrow('--create-board configures a workflow')
      expect(() => buildPrefillFromOptions({ workflow: 'solo', tracker: 'jira', createBoard: true })).toThrow('creates a GitHub Projects board, not a jira one')
    })
  })
})
