import {
  buildTechnicalTransitionPrefillFromOptions,
  buildUpdatePrefillFromOptions,
  parseAddModules,
  parseConflictStrategy,
  parseTargetProfile,
  UpdateCommandOptions,
  validateTechnicalTransitionOptions,
  validateUpdateOutputOptions
} from '../../../commands/update.options'

describe('parseAddModules', () => {
  it('returns undefined when the flag is absent', () => {
    expect(parseAddModules(undefined)).toBeUndefined()
  })

  it('returns an empty array for an empty string', () => {
    expect(parseAddModules('')).toEqual([])
  })

  it('parses a CSV and trims whitespace', () => {
    expect(parseAddModules('email, storage ,  analytics')).toEqual(['email', 'storage', 'analytics'])
  })

  it('filters out empty entries', () => {
    expect(parseAddModules('email,,storage,')).toEqual(['email', 'storage'])
  })
})

describe('parseConflictStrategy', () => {
  it('defaults to save-new (preserves pre-#59 behavior)', () => {
    expect(parseConflictStrategy(undefined)).toBe('save-new')
  })

  it.each(['keep', 'replace', 'save-new'] as const)('accepts %s', (value) => {
    expect(parseConflictStrategy(value)).toBe(value)
  })

  it('throws on unknown strategies', () => {
    expect(() => parseConflictStrategy('skip')).toThrow(/Invalid --conflict-strategy/)
  })
})

describe('parseTargetProfile', () => {
  it('leaves the transition disabled when the flag is absent', () => {
    expect(parseTargetProfile(undefined)).toBeUndefined()
  })

  it('accepts the only additive v1 target', () => {
    expect(parseTargetProfile('full')).toBe('full')
  })

  it.each(['stack', 'harness', 'FULL', '', ' full '])('rejects unsupported or non-canonical target %p', (value) => {
    expect(() => parseTargetProfile(value)).toThrow(/Invalid --target-profile.*V1 supports only: full/)
  })
})

describe('validateUpdateOutputOptions', () => {
  it('allows regular and dry-run output', () => {
    expect(() => validateUpdateOutputOptions({})).not.toThrow()
    expect(() => validateUpdateOutputOptions({ dryRun: true })).not.toThrow()
    expect(() => validateUpdateOutputOptions({ dryRun: true, json: true })).not.toThrow()
  })

  it('requires --dry-run for machine-readable JSON', () => {
    expect(() => validateUpdateOutputOptions({ json: true })).toThrow('The --json option requires --dry-run.')
    expect(() => validateUpdateOutputOptions({ dryRun: false, json: true })).toThrow('The --json option requires --dry-run.')
  })
})

describe('validateTechnicalTransitionOptions', () => {
  it('accepts every documented technical enum', () => {
    expect(() => validateTechnicalTransitionOptions({ structure: 'monorepo', dbSetup: 'docker', dbType: 'postgresql', emailService: 'none', s3Setup: 'manual' })).not.toThrow()
  })

  it.each([
    ['structure', 'monorep', '--structure'],
    ['dbSetup', 'dockre', '--db-setup'],
    ['dbType', 'mysql', '--db-type'],
    ['emailService', 'smtp', '--email-service'],
    ['s3Setup', 'local', '--s3-setup']
  ] as const)('rejects invalid %s values before project I/O', (field, value, flag) => {
    expect(() => validateTechnicalTransitionOptions({ [field]: value } as unknown as UpdateCommandOptions)).toThrow(flag)
  })
})

describe('buildTechnicalTransitionPrefillFromOptions', () => {
  it('returns no technical decisions when none were provided', () => {
    expect(buildTechnicalTransitionPrefillFromOptions({})).toEqual({})
  })

  it('maps every technical choice shared with sf new', () => {
    expect(
      buildTechnicalTransitionPrefillFromOptions({
        projectDescription: 'Acme application',
        structure: 'multirepo',
        dbSetup: 'credentials',
        dbType: 'postgresql',
        dbHost: 'db.example.com',
        dbPort: '5432',
        dbUser: 'acme',
        dbPassword: 'secret',
        dbName: 'acme_prod',
        emailService: 'mailersend',
        mailersendApiKey: 'ms-key',
        mailersendSenderEmail: 'hello@acme.com',
        mailersendSenderName: 'Acme',
        s3Setup: 'credentials',
        s3Endpoint: 'https://s3.example.com',
        s3AccessKey: 'key',
        s3SecretKey: 'secret',
        s3Bucket: 'uploads',
        s3Region: 'eu-west-1',
        analytics: true,
        pwa: false
      })
    ).toEqual({
      projectDescription: 'Acme application',
      isMonorepo: false,
      dbSetup: 'credentials',
      dbCredentials: {
        dbType: 'postgresql',
        host: 'db.example.com',
        port: '5432',
        user: 'acme',
        password: 'secret',
        database: 'acme_prod'
      },
      emailService: 'mailersend',
      mailersendApiKey: 'ms-key',
      mailersendSenderEmail: 'hello@acme.com',
      mailersendSenderName: 'Acme',
      s3Setup: 'credentials',
      s3Credentials: {
        endpoint: 'https://s3.example.com',
        accessKey: 'key',
        secretKey: 'secret',
        bucket: 'uploads',
        region: 'eu-west-1'
      },
      includeAnalytics: true,
      includePwa: false
    })
  })

  it('supports manual infrastructure without inventing credential objects', () => {
    expect(buildTechnicalTransitionPrefillFromOptions({ structure: 'monorepo', dbSetup: 'manual', s3Setup: 'manual' })).toEqual({
      isMonorepo: true,
      dbSetup: 'manual',
      s3Setup: 'manual'
    })
  })

  it('materialises the documented PWA default for non-interactive adoption', () => {
    expect(buildTechnicalTransitionPrefillFromOptions({ nonInteractive: true })).toEqual({ includePwa: true })
    expect(buildTechnicalTransitionPrefillFromOptions({ nonInteractive: true, pwa: false })).toEqual({ includePwa: false })
  })

  it('does not mix port resolution into config-engine prefill', () => {
    expect(buildTechnicalTransitionPrefillFromOptions({ apiPort: '3501', webPort: '5174' })).toEqual({})
  })
})

describe('buildUpdatePrefillFromOptions', () => {
  it('returns empty prefill branches when no options are provided', () => {
    expect(buildUpdatePrefillFromOptions({})).toEqual({ email: {}, storage: {}, skills: {}, srs: {} })
  })

  it('parses --add-modules into selectedModules', () => {
    const prefill = buildUpdatePrefillFromOptions({ addModules: 'email,storage' })
    expect(prefill.selectedModules).toEqual(['email', 'storage'])
  })

  it('omits selectedModules when --add-modules is absent', () => {
    expect(buildUpdatePrefillFromOptions({}).selectedModules).toBeUndefined()
  })

  it('auto-sets email.ready = true in non-interactive mode', () => {
    const prefill = buildUpdatePrefillFromOptions({ nonInteractive: true })
    expect(prefill.email.ready).toBe(true)
  })

  it('leaves email.ready unset when interactive', () => {
    expect(buildUpdatePrefillFromOptions({}).email.ready).toBeUndefined()
  })

  it('maps mailersend credentials flags', () => {
    const prefill = buildUpdatePrefillFromOptions({
      mailersendApiKey: 'ms-key',
      mailersendSenderEmail: 'hello@acme.com',
      mailersendSenderName: 'Acme'
    })
    expect(prefill.email).toEqual({
      mailersendApiKey: 'ms-key',
      mailersendSenderEmail: 'hello@acme.com',
      mailersendSenderName: 'Acme'
    })
  })

  it('maps storage flags (s3Setup + credentials)', () => {
    const prefill = buildUpdatePrefillFromOptions({
      s3Setup: 'credentials',
      s3Endpoint: 'https://s3.example.com',
      s3AccessKey: 'AKIA...',
      s3SecretKey: 'secret',
      s3Bucket: 'acme-uploads',
      s3Region: 'eu-west-1'
    })
    expect(prefill.storage).toEqual({
      s3Setup: 'credentials',
      endpoint: 'https://s3.example.com',
      accessKey: 'AKIA...',
      secretKey: 'secret',
      bucket: 'acme-uploads',
      region: 'eu-west-1'
    })
  })

  it('does not pass the transition-only manual choice to the legacy storage-module prompt', () => {
    expect(buildUpdatePrefillFromOptions({ s3Setup: 'manual' }).storage).toEqual({})
  })

  it('maps skill credentials flags', () => {
    const opts: UpdateCommandOptions = {
      context7ApiKey: 'c7',
      atlassianEmail: 'a@b.c',
      atlassianApiToken: 'tok',
      atlassianSite: 'acme',
      atlassianCloudId: 'cloud-1',
      notionApiToken: 'n-tok',
      notionApiVersion: '2022-06-28',
      figmaApiToken: 'f-tok'
    }
    const prefill = buildUpdatePrefillFromOptions(opts)
    expect(prefill.skills).toEqual({
      context7ApiKey: 'c7',
      atlassianEmail: 'a@b.c',
      atlassianApiToken: 'tok',
      atlassianSite: 'acme',
      atlassianCloudId: 'cloud-1',
      notionApiToken: 'n-tok',
      notionApiVersion: '2022-06-28',
      figmaApiToken: 'f-tok'
    })
  })

  it('only includes fields that were explicitly provided', () => {
    const prefill = buildUpdatePrefillFromOptions({ s3Bucket: 'only-bucket' })
    expect(prefill.storage).toEqual({ bucket: 'only-bucket' })
    expect(prefill.email).toEqual({})
    expect(prefill.skills).toEqual({})
    expect(prefill.srs).toEqual({})
  })

  it('reads secret values from SF_UPDATE environment variables without requiring argv flags', () => {
    const previous = {
      db: process.env.SF_UPDATE_DB_PASSWORD,
      mailer: process.env.SF_UPDATE_MAILERSEND_API_KEY,
      s3Access: process.env.SF_UPDATE_S3_ACCESS_KEY,
      s3Secret: process.env.SF_UPDATE_S3_SECRET_KEY
    }
    process.env.SF_UPDATE_DB_PASSWORD = 'env-db'
    process.env.SF_UPDATE_MAILERSEND_API_KEY = 'env-mailer'
    process.env.SF_UPDATE_S3_ACCESS_KEY = 'env-access'
    process.env.SF_UPDATE_S3_SECRET_KEY = 'env-secret'
    try {
      expect(buildTechnicalTransitionPrefillFromOptions({ dbSetup: 'credentials', emailService: 'mailersend', s3Setup: 'credentials' })).toMatchObject({
        dbCredentials: { password: 'env-db' },
        mailersendApiKey: 'env-mailer',
        s3Credentials: { accessKey: 'env-access', secretKey: 'env-secret' }
      })
      expect(buildUpdatePrefillFromOptions({})).toMatchObject({ email: { mailersendApiKey: 'env-mailer' }, storage: { accessKey: 'env-access', secretKey: 'env-secret' } })
    } finally {
      if (previous.db === undefined) delete process.env.SF_UPDATE_DB_PASSWORD
      else process.env.SF_UPDATE_DB_PASSWORD = previous.db
      if (previous.mailer === undefined) delete process.env.SF_UPDATE_MAILERSEND_API_KEY
      else process.env.SF_UPDATE_MAILERSEND_API_KEY = previous.mailer
      if (previous.s3Access === undefined) delete process.env.SF_UPDATE_S3_ACCESS_KEY
      else process.env.SF_UPDATE_S3_ACCESS_KEY = previous.s3Access
      if (previous.s3Secret === undefined) delete process.env.SF_UPDATE_S3_SECRET_KEY
      else process.env.SF_UPDATE_S3_SECRET_KEY = previous.s3Secret
    }
  })

  it('maps srs flags into prefill.srs', () => {
    const prefill = buildUpdatePrefillFromOptions({
      srsBackend: 'notion',
      srsParentPageInput: 'https://notion.so/parent',
      notionApiToken: 'n-tok',
      notionApiVersion: '2022-06-28'
    })
    expect(prefill.srs).toEqual({
      srsBackend: 'notion',
      srsParentPageInput: 'https://notion.so/parent',
      notionApiToken: 'n-tok',
      notionApiVersion: '2022-06-28'
    })
  })
})
