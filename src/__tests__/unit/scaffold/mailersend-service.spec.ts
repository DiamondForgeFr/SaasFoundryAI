import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as ts from 'typescript'

/**
 * #976 — a generated project could not complete a signup or an invitation locally: every email
 * went to MailerSend, and nothing on the developer's machine read it. The service now hands the
 * email to a Mailpit inbox while `MAIL_CATCHER_URL` is set.
 *
 * The template is generated-project code, written in NestJS and TypeScript the CLI does not
 * depend on. It is compiled here with the CLI's own TypeScript and run against stand-ins for its
 * four imports, so what is asserted is the service's behaviour, not its text.
 */

const TEMPLATE = resolve(__dirname, '../../../../scaffolds/overlays/modules/email/services/mailersend.service.ts')

interface Env {
  [key: string]: string | undefined
}

const SENDER = { MAILERSEND_API_KEY: 'ms_test_fake_key_12345', MAILERSEND_SENDER_EMAIL: 'noreply@acme.test', MAILERSEND_SENDER_NAME: 'Acme' }

/** What `fetch` answers. A rejection is a connection that never happened. */
type FetchAnswer = { ok: boolean; status: number } | Error

function loadService(env: Env, answer: FetchAnswer = { ok: true, status: 200 }) {
  const { outputText } = ts.transpileModule(readFileSync(TEMPLATE, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true }
  })

  const mailerSendSend = jest.fn().mockResolvedValue({ headers: { 'x-message-id': 'ms-1' } })
  const fetchMock = jest.fn().mockImplementation(() => (answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)))
  const logger = { debug: jest.fn(), error: jest.fn() }
  const chain = new Proxy({}, { get: () => () => chain })

  const stubs: Record<string, unknown> = {
    '@nestjs/common': { Injectable: () => (target: unknown) => target },
    mailersend: {
      MailerSend: class {
        email = { send: mailerSendSend }
      },
      EmailParams: class {
        constructor() {
          return chain
        }
      },
      Recipient: class {}
    },
    '@common/services/logger/logger.service': { Logger: class {} },
    '@configs/env/services/env.service': { EnvConfig: class {} }
  }
  const module = { exports: {} as { MailerSendService: new (env: unknown, logger: unknown) => { sendEmail(options: Record<string, unknown>): Promise<void> } } }
  new Function('exports', 'require', 'module', 'fetch', outputText)(
    module.exports,
    (id: string) => {
      if (!(id in stubs)) throw new Error(`The service imported ${id}, which this spec does not stand in for`)
      return stubs[id]
    },
    module,
    fetchMock
  )
  const values: Env = { ...SENDER, NODE_ENV: 'development', ...env }
  const service = new module.exports.MailerSendService({ get: (key: string) => values[key] }, logger)
  return { service, fetchMock, mailerSendSend, logger }
}

const MAIL = {
  to: 'new.user@acme.test',
  subject: 'Confirm your account',
  html: '<a href="http://localhost:5173/signin?confirmAccountToken=abc">Confirm</a>',
  text: 'Confirm: http://localhost:5173/signin?confirmAccountToken=abc'
}

describe('MailerSendService with a mail catcher (#976)', () => {
  it('hands the email to the inbox over its HTTP API, in the shape Mailpit documents', async () => {
    const { service, fetchMock, mailerSendSend } = loadService({ MAIL_CATCHER_URL: 'http://localhost:8025' })

    await service.sendEmail(MAIL)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:8025/api/v1/send')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'content-type': 'application/json' })
    expect(JSON.parse(init.body)).toEqual({
      From: { Email: 'noreply@acme.test', Name: 'Acme' },
      To: [{ Email: 'new.user@acme.test' }],
      Subject: 'Confirm your account',
      HTML: MAIL.html,
      Text: MAIL.text
    })
    // Not a word to MailerSend: that is the whole point of the catcher
    expect(mailerSendSend).not.toHaveBeenCalled()
  })

  it('tolerates a trailing slash on the URL and a message without a text part', async () => {
    const { service, fetchMock } = loadService({ MAIL_CATCHER_URL: 'http://localhost:8030/' })

    await service.sendEmail({ to: MAIL.to, subject: MAIL.subject, html: MAIL.html })

    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:8030/api/v1/send')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).Text).toBe('')
  })

  it('sends through MailerSend when the variable is not set, as before', async () => {
    const { service, fetchMock, mailerSendSend } = loadService({})

    await service.sendEmail(MAIL)

    expect(mailerSendSend).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('treats an empty variable as not set, so a developer can switch the catcher off without deleting the line', async () => {
    const { service, fetchMock, mailerSendSend } = loadService({ MAIL_CATCHER_URL: '' })

    await service.sendEmail(MAIL)

    expect(mailerSendSend).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('says how to start the inbox when nothing answers, instead of a bare "fetch failed"', async () => {
    const { service } = loadService({ MAIL_CATCHER_URL: 'http://localhost:8025' }, new TypeError('fetch failed'))

    await expect(service.sendEmail(MAIL)).rejects.toThrow(
      /The mail catcher at http:\/\/localhost:8025 did not answer \(fetch failed\)\. Start it with `npm run services:up`, or remove MAIL_CATCHER_URL/
    )
  })

  it('reports the status when the inbox refuses the message', async () => {
    const { service } = loadService({ MAIL_CATCHER_URL: 'http://localhost:8025' }, { ok: false, status: 400 })

    await expect(service.sendEmail(MAIL)).rejects.toThrow('The mail catcher at http://localhost:8025 rejected the message with status 400')
  })

  it('refuses to be used in production, where nothing reads the inbox', async () => {
    const { service, fetchMock, mailerSendSend } = loadService({ MAIL_CATCHER_URL: 'http://localhost:8025', NODE_ENV: 'production' })

    await expect(service.sendEmail(MAIL)).rejects.toThrow('MAIL_CATCHER_URL is a development setting: remove it from the production environment')
    // Neither the inbox nor MailerSend got the message: an email that silently went to a catcher in production is the failure this guards
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mailerSendSend).not.toHaveBeenCalled()
  })

  it('leaves the lifecycle harness seam first: the Docker lane keeps reading its own mailbox', async () => {
    const { service, fetchMock } = loadService({
      MAIL_CATCHER_URL: 'http://localhost:8025',
      SF_LIFECYCLE_MAILBOX_URL: 'http://127.0.0.1:59999',
      SF_LIFECYCLE_MAILBOX_CAPABILITY: 'c'.repeat(32),
      SF_LIFECYCLE_ALLOW_INSECURE_HTTP: 'true',
      NODE_ENV: 'production'
    })

    await service.sendEmail(MAIL)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:59999/messages')
  })
})
