import { buildUpdatePrefillFromOptions, parseAddModules, parseConflictStrategy, UpdateCommandOptions } from '../../../commands/update.options'

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

describe('buildUpdatePrefillFromOptions', () => {
  it('returns empty prefill branches when no options are provided', () => {
    expect(buildUpdatePrefillFromOptions({})).toEqual({ email: {}, storage: {}, skills: {} })
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
  })
})
