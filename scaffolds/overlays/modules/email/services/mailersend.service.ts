/**
 * Resources
 */
import { Injectable } from '@nestjs/common'
import { EmailParams, MailerSend, Recipient } from 'mailersend'

/**
 * Dependencies
 */
import { Logger } from '@common/services/logger/logger.service'
import { EnvConfig } from '@configs/env/services/env.service'

/**
 * Declaration
 */
export interface EmailOptions {
  to: string
  subject: string
  html: string
  text?: string
}

@Injectable()
export class MailerSendService {
  private readonly mailerSend: MailerSend
  private readonly senderEmail: string
  private readonly senderName: string

  constructor(
    private readonly env: EnvConfig,
    private readonly logger: Logger
  ) {
    const apiKey = this.env.get('MAILERSEND_API_KEY')
    this.logger.debug(`Initializing MailerSend with API key: ${apiKey.substring(0, 5)}...`, 'MailerSendService')

    this.mailerSend = new MailerSend({
      apiKey
    })
    this.senderEmail = this.env.get('MAILERSEND_SENDER_EMAIL')
    this.senderName = this.env.get('MAILERSEND_SENDER_NAME')

    this.logger.debug(`MailerSend configured with sender: ${this.senderName} <${this.senderEmail}>`, 'MailerSendService')
  }

  async sendEmail(options: EmailOptions): Promise<void> {
    try {
      this.logger.debug(`Preparing email to ${options.to}`, 'MailerSendService')

      const lifecycleMailboxUrl = this.env.get('SF_LIFECYCLE_MAILBOX_URL')
      const lifecycleCapability = this.env.get('SF_LIFECYCLE_MAILBOX_CAPABILITY')
      const lifecycleHttp = this.env.get('SF_LIFECYCLE_ALLOW_INSECURE_HTTP') === 'true'
      if (lifecycleMailboxUrl || lifecycleCapability || lifecycleHttp) {
        if (!lifecycleMailboxUrl || !lifecycleCapability || !lifecycleHttp) throw new Error('Lifecycle mailbox configuration must provide URL, capability and insecure HTTP flag together')
        const response = await fetch(`${lifecycleMailboxUrl.replace(/\/$/, '')}/messages`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${lifecycleCapability}`,
            'content-type': 'application/json'
          },
          body: JSON.stringify(options)
        })
        if (!response.ok) throw new Error(`Lifecycle mailbox rejected the message with status ${response.status}`)
        this.logger.debug(`Email captured by the lifecycle mailbox for ${options.to}`, 'MailerSendService')
        return
      }

      // Development only: with MAIL_CATCHER_URL set in the dev `.env`, the email goes to the local
      // Mailpit inbox (see docker-compose.dev-services.yml) instead of MailerSend. It is an explicit
      // switch, never read from the deployment workflow, and refused in production.
      const mailCatcherUrl = this.env.get('MAIL_CATCHER_URL')
      if (mailCatcherUrl) {
        await this.sendToMailCatcher(mailCatcherUrl, options)
        return
      }

      const emailParams = new EmailParams()
        .setFrom({
          email: this.senderEmail,
          name: this.senderName
        })
        .setTo([new Recipient(options.to)])
        .setSubject(options.subject)
        .setHtml(options.html)
        .setText(options.text || '')

      this.logger.debug(`Sending email to ${options.to} with subject: ${options.subject}`, 'MailerSendService')
      const response = await this.mailerSend.email.send(emailParams)

      this.logger.debug(`Email sent successfully to ${options.to}`, 'MailerSendService')
      this.logger.debug(`Message ID: ${response.headers['x-message-id']}`, 'MailerSendService')
    } catch (error) {
      let errorMessage = 'Unknown error'
      let errorStack: string | undefined = undefined

      if (error instanceof Error) {
        errorMessage = error.message
        errorStack = error.stack
        this.logger.error(`MailerSend error details: ${JSON.stringify(error, null, 2)}`, 'MailerSendService')
      } else {
        this.logger.error(`MailerSend error (not an Error instance): ${JSON.stringify(error, null, 2)}`, 'MailerSendService')
      }

      this.logger.error(`Failed to send email to ${options.to}: ${errorMessage}`, errorStack, 'MailerSendService')
      throw new Error(`Failed to send email: ${errorMessage}`)
    }
  }

  /**
   * Hand the email to the development mail catcher (Mailpit) over its HTTP API: no SMTP client, no
   * new dependency. The message shows up in the inbox at the catcher's own URL.
   */
  private async sendToMailCatcher(catcherUrl: string, options: EmailOptions): Promise<void> {
    if (this.env.get('NODE_ENV') === 'production') {
      throw new Error('MAIL_CATCHER_URL is a development setting: remove it from the production environment')
    }

    const response = await fetch(`${catcherUrl.replace(/\/$/, '')}/api/v1/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        From: { Email: this.senderEmail, Name: this.senderName },
        To: [{ Email: options.to }],
        Subject: options.subject,
        HTML: options.html,
        Text: options.text ?? ''
      })
    }).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : 'unknown error'
      throw new Error(`The mail catcher at ${catcherUrl} did not answer (${reason}). Start it with \`npm run services:up\`, or remove MAIL_CATCHER_URL from .env to send through MailerSend`)
    })
    if (!response.ok) throw new Error(`The mail catcher at ${catcherUrl} rejected the message with status ${response.status}`)

    this.logger.debug(`Email captured by the mail catcher for ${options.to}: open ${catcherUrl} to read it`, 'MailerSendService')
  }
}
