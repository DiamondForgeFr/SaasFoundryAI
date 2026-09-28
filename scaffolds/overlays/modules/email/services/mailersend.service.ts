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
}
