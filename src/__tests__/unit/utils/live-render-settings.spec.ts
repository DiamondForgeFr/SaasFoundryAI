import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { repairedPlaceholderBaselines } from '../../../commands/update'
import { targetManifestVersion } from '../../../migrations/manifest/registry'
import { manifestSchemaUrl, type SaaSFoundryManifest } from '../../../types'
import { legacyRenderSettings, readLiveRenderSettings, sameRenderSettings } from '../../../utils/live-render-settings'

const manifestFor = (structure: 'monorepo' | 'multirepo', modules: Partial<SaaSFoundryManifest['modules']> = {}): SaaSFoundryManifest => ({
  $schema: manifestSchemaUrl,
  manifestVersion: targetManifestVersion(),
  version: '1.0.1',
  generatedAt: '2026-06-22T21:07:04.662Z',
  structure,
  projectName: 'forge',
  mainBranch: 'master',
  modules: { email: { provider: 'mailersend', version: 1 }, s3Setup: 'manual', dbSetup: 'manual', includeAnalytics: false, advancedSkills: [], ...modules }
})

describe('readLiveRenderSettings (#1151)', () => {
  let root: string

  const put = async (path: string, content: string) => {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), content)
  }
  const workflowLines = (email: string, name: string) => `      run: |\n            env_line MAILERSEND_SENDER_EMAIL ${email}\n            env_line MAILERSEND_SENDER_NAME ${name}\n`

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sf-live-settings-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('reads the sender from the monorepo deployment workflow, unquoting the shell word', async () => {
    await put('.github/workflows/deployment-api.yml', workflowLines(`'noreply@forge.fr'`, `'Forge'\\''s Mail'`))
    await put('apps/api/.env.test', 'MAILERSEND_SENDER_EMAIL="other@forge.fr"\nMAILERSEND_SENDER_NAME="Other"\n')

    expect(await readLiveRenderSettings(manifestFor('monorepo'), root)).toMatchObject({ mailersendSenderEmail: 'noreply@forge.fr', mailersendSenderName: "Forge's Mail" })
  })

  it('reads the multirepo workflow of the API repository', async () => {
    await put('apps/forge-api/.github/workflows/deployment.yml', workflowLines(`'noreply@forge.fr'`, `'Forge'`))

    expect(await readLiveRenderSettings(manifestFor('multirepo'), root)).toMatchObject({ mailersendSenderEmail: 'noreply@forge.fr', mailersendSenderName: 'Forge' })
  })

  it('falls back to the committed .env.test, then .env, when the workflow line is not in the installer form', async () => {
    await put('.github/workflows/deployment-api.yml', workflowLines('"$MAILERSEND_SENDER_EMAIL"', `'Forge'`))
    await put('apps/api/.env', 'MAILERSEND_SENDER_EMAIL="local@forge.fr"\nMAILERSEND_SENDER_NAME="Local"\n')
    expect(await readLiveRenderSettings(manifestFor('monorepo'), root)).toMatchObject({ mailersendSenderEmail: 'local@forge.fr', mailersendSenderName: 'Forge' })

    await put('apps/api/.env.test', 'MAILERSEND_SENDER_EMAIL="noreply@forge.fr"\n# MAILERSEND_SENDER_NAME=""\n')
    expect(await readLiveRenderSettings(manifestFor('monorepo'), root)).toMatchObject({ mailersendSenderEmail: 'noreply@forge.fr', mailersendSenderName: 'Forge' })
  })

  it('looks past the pre-#1151 placeholder pair, and keeps it only when nothing else knows the sender', async () => {
    await put('.github/workflows/deployment-api.yml', workflowLines(`'noreply@example.com'`, `'App'`))
    expect(await readLiveRenderSettings(manifestFor('monorepo'), root)).toMatchObject({ mailersendSenderEmail: 'noreply@example.com', mailersendSenderName: 'App' })

    await put('apps/api/.env.test', 'MAILERSEND_SENDER_EMAIL="noreply@forge.fr"\nMAILERSEND_SENDER_NAME="Forge"\n')
    expect(await readLiveRenderSettings(manifestFor('monorepo'), root)).toMatchObject({ mailersendSenderEmail: 'noreply@forge.fr', mailersendSenderName: 'Forge' })
  })

  it('renders an empty sender when the project has none, and none without MailerSend', async () => {
    expect(await readLiveRenderSettings(manifestFor('monorepo'), root)).toMatchObject({ mailersendSenderEmail: '', mailersendSenderName: '' })
    const settings = await readLiveRenderSettings(manifestFor('monorepo', { email: { provider: 'none', version: 1 } }), root)
    expect(settings.mailersendSenderEmail).toBeUndefined()
    expect(settings.mailersendSenderName).toBeUndefined()
  })

  it('reads the Docker database credentials and bucket from the dev-services compose file, then .env', async () => {
    const docker = manifestFor('monorepo', { email: { provider: 'none', version: 1 }, dbSetup: 'docker', s3Setup: 'docker' })
    await put('apps/api/.env', 'DATABASE_URL="postgresql://envuser:envpass@localhost:5435/envdb"\nS3_BUCKET="env-bucket"\n')
    expect(await readLiveRenderSettings(docker, root)).toMatchObject({ dbUser: 'envuser', dbPassword: 'envpass', dbName: 'envdb', s3Bucket: 'env-bucket' })

    await put(
      'apps/api/docker-compose.dev-services.yml',
      '      POSTGRES_USER: forge\n      POSTGRES_PASSWORD: anvil\n      POSTGRES_DB: forge_dev\n      done; mc mb --ignore-existing myminio/forge-assets; mc anonymous set download myminio/forge-assets; "\n'
    )
    expect(await readLiveRenderSettings(docker, root)).toMatchObject({ dbUser: 'forge', dbPassword: 'anvil', dbName: 'forge_dev', s3Bucket: 'forge-assets' })
  })

  it('leaves the project-named bucket and the database defaults to the template', async () => {
    const docker = manifestFor('monorepo', { email: { provider: 'none', version: 1 }, dbSetup: 'docker', s3Setup: 'docker' })
    await put('apps/api/docker-compose.dev-services.yml', 'mc mb --ignore-existing myminio/forge-uploads;\n')

    const settings = await readLiveRenderSettings(docker, root)
    expect(settings).toMatchObject({ dbUser: 'db_dev_user', dbPassword: 'db_dev_password', dbName: 'db_dev', s3Bucket: undefined })
    expect(sameRenderSettings(settings, legacyRenderSettings(docker))).toBe(true)
  })
})

describe('repairedPlaceholderBaselines (#1151)', () => {
  const real = 'real-render'
  const legacy = 'placeholder-render'

  it('replaces a placeholder baseline with the target when the project has its own copy', () => {
    expect(repairedPlaceholderBaselines({ wf: legacy }, { wf: 'user-edit' }, { wf: real }, { wf: legacy })).toEqual({ wf: real })
  })

  it('keeps the baseline of a file still equal to the placeholder render, so the plan restores it', () => {
    expect(repairedPlaceholderBaselines({ wf: legacy }, { wf: legacy }, { wf: real }, { wf: legacy })).toEqual({ wf: legacy })
  })

  it('keeps the baseline of a deleted file, so the plan restores it as before', () => {
    expect(repairedPlaceholderBaselines({ wf: legacy }, {}, { wf: real }, { wf: legacy })).toEqual({ wf: legacy })
  })

  it('leaves a baseline from an older template alone: that difference is a real template change', () => {
    expect(repairedPlaceholderBaselines({ wf: 'older-template' }, { wf: 'user-edit' }, { wf: real }, { wf: legacy })).toEqual({ wf: 'older-template' })
  })
})
