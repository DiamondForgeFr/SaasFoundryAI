import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join, resolve } from 'path'

import { depositEmailDeployConfig } from '../../../installers/email.installer'

const SCAFFOLDS = resolve(__dirname, '../../../../scaffolds')

// #888 — the email installer filled the API's own deploy workflow, which a monorepo does not have:
// its root `deployment-api.yml` wrote a server `.env` without any MailerSend value
describe('depositEmailDeployConfig', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'sf-email-deploy-'))
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  const place = (from: string, to: string) => {
    mkdirSync(dirname(join(root, to)), { recursive: true })
    copyFileSync(join(SCAFFOLDS, from), join(root, to))
  }
  const installMailer = (apiPath: string, env = 'MAILERSEND_SENDER_EMAIL="noreply@acme.test"\nMAILERSEND_SENDER_NAME="Acme Team"\n') => {
    mkdirSync(join(root, apiPath, 'src/modules/email/services'), { recursive: true })
    writeFileSync(join(root, apiPath, 'src/modules/email/services/mailersend.service.ts'), '')
    writeFileSync(join(root, apiPath, '.env'), env)
  }
  const configured = (workflow: string) => {
    const content = readFileSync(join(root, workflow), 'utf8')
    expect(content).toMatch(/^\s+MAILERSEND_API_KEY: \$\{\{ secrets\.MAILERSEND_API_KEY \}\}$/m)
    expect(content).toMatch(/^\s+env_line MAILERSEND_API_KEY "\$MAILERSEND_API_KEY"$/m)
    return content
  }

  it("fills the monorepo root workflow, reading the sender from the API's .env", async () => {
    place('overlays/monorepo/root/.github/workflows/deployment-api.yml', '.github/workflows/deployment-api.yml')
    installMailer('apps/api')

    await depositEmailDeployConfig({ apiPath: join(root, 'apps/api') })

    const content = configured('.github/workflows/deployment-api.yml')
    expect(content).toContain("env_line MAILERSEND_SENDER_EMAIL 'noreply@acme.test'")
    expect(content).toContain("env_line MAILERSEND_SENDER_NAME 'Acme Team'")
  })

  it("fills a multirepo API's workflow with the values it is given, and is idempotent", async () => {
    place('blueprints/api/.github/workflows/deployment.yml', 'acme-api/.github/workflows/deployment.yml')
    installMailer('acme-api', '')

    await depositEmailDeployConfig({ apiPath: join(root, 'acme-api'), mailersendSenderEmail: 'hello@acme.test', mailersendSenderName: "Acme's team" })
    const once = configured('acme-api/.github/workflows/deployment.yml')
    await depositEmailDeployConfig({ apiPath: join(root, 'acme-api') })

    expect(once).toContain("env_line MAILERSEND_SENDER_NAME 'Acme'\\''s team'")
    expect(readFileSync(join(root, 'acme-api/.github/workflows/deployment.yml'), 'utf8')).toBe(once)
  })

  it('leaves a project without the email module untouched', async () => {
    place('overlays/monorepo/root/.github/workflows/deployment-api.yml', '.github/workflows/deployment-api.yml')
    mkdirSync(join(root, 'apps/api'), { recursive: true })
    const before = readFileSync(join(root, '.github/workflows/deployment-api.yml'), 'utf8')

    await depositEmailDeployConfig({ apiPath: join(root, 'apps/api') })

    expect(readFileSync(join(root, '.github/workflows/deployment-api.yml'), 'utf8')).toBe(before)
  })
})
