import type { LiveSuiteContract } from '../contracts'

interface MailboxMessage {
  id: number
  to: string
  subject: string
  html: string
  text: string
  capturedAt: string
}

export async function resetMailbox(contract: LiveSuiteContract): Promise<void> {
  const response = await fetch(`${contract.mailboxUrl}/messages`, { method: 'DELETE', headers: authorization(contract) })
  if (!response.ok) throw new Error(`Mailbox reset failed with status ${response.status}.`)
}

export async function waitForMail(contract: LiveSuiteContract, recipient: string, timeoutMs = 10_000): Promise<MailboxMessage> {
  const deadline = Math.min(contract.deadline, Date.now() + timeoutMs)
  while (Date.now() < deadline) {
    const response = await fetch(`${contract.mailboxUrl}/messages?to=${encodeURIComponent(recipient)}`, { headers: authorization(contract) })
    if (!response.ok) throw new Error(`Mailbox inspection failed with status ${response.status}.`)
    const document = (await response.json()) as { messages?: MailboxMessage[] }
    const message = document.messages?.at(-1)
    if (message) return message
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`No lifecycle message arrived for ${recipient}.`)
}

export function messageLink(message: MailboxMessage, expectedPath: string): string {
  const values = `${message.text}\n${message.html}`.match(/https?:\/\/[^\s"'<>]+/g) ?? []
  const match = values.map((value) => value.replace(/&amp;/g, '&')).find((value) => new URL(value).pathname === expectedPath)
  if (!match) throw new Error(`Message ${message.id} did not contain a ${expectedPath} link.`)
  return match
}

function authorization(contract: LiveSuiteContract): Record<string, string> {
  return { authorization: `Bearer ${contract.mailboxCapability}` }
}
