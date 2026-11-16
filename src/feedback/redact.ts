/**
 * Redaction of what `sf feedback bug --auto-repro` publishes.
 *
 * A bug report lands on a GitHub repository, so every string the repro carries goes through
 * {@link redactText} first. The rules start from the ones `plan-feedback-bug.js` applies to a captured
 * stderr (the `tool-saasfoundry` skill) and add the credential shapes this CLI's own modules produce
 * (MailerSend, Notion) plus the places a credential hides in a URL or a PEM block. The repro is kept at
 * least as strict as the skill; a rule added there belongs here too.
 *
 * Order matters: the narrowest rule runs first, so a token is named for what it is before a broader rule
 * can swallow part of it.
 */
interface RedactionRule {
  pattern: RegExp
  replacement: string
}

const REDACTION_RULES: readonly RedactionRule[] = [
  // PEM blocks: the whole key, header and footer included
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, replacement: '<private-key>' },
  // JWTs: three base64url chunks separated by dots
  { pattern: /\bey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, replacement: '<jwt>' },
  // Provider-prefixed tokens: GitHub, OpenAI, Stripe, Slack, AWS, Google, MailerSend, Notion
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, replacement: '<github-token>' },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, replacement: '<github-token>' },
  { pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g, replacement: '<api-key>' },
  { pattern: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{20,}\b/g, replacement: '<stripe-key>' },
  { pattern: /\bxox[abpors]-[A-Za-z0-9-]{10,}\b/g, replacement: '<slack-token>' },
  { pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, replacement: '<aws-key>' },
  { pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g, replacement: '<google-key>' },
  { pattern: /\bmlsn\.[A-Za-z0-9]{20,}\b/g, replacement: '<mailersend-token>' },
  { pattern: /\b(?:secret|ntn)_[A-Za-z0-9]{20,}\b/g, replacement: '<notion-token>' },
  // Authorization headers
  { pattern: /\b[Bb]earer\s+[A-Za-z0-9._~+/=-]{10,}/g, replacement: 'Bearer <redacted>' },
  { pattern: /\b[Bb]asic\s+[A-Za-z0-9+/=]{10,}/g, replacement: 'Basic <redacted>' },
  // Credentials inside a URL: scheme://user:password@host, and scheme://token@host
  { pattern: /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@'"]+@/gi, replacement: '$1<redacted>@' },
  // CLI arg / env / query-string secrets: --token=xxx, SECRET_KEY=xxx, ?token=xxx
  { pattern: /(--(?:token|password|secret|api[-_]?key|auth|access[-_]?token|refresh[-_]?token)[=\s])[^\s&"']+/gi, replacement: '$1<redacted>' },
  { pattern: /\b([A-Z][A-Z0-9_]*(?:TOKEN|PASSWORD|SECRET|API_?KEY|AUTH|PRIVATE_?KEY))\s*[:=]\s*["']?[^"'\s]+["']?/g, replacement: '$1=<redacted>' },
  { pattern: /([?&](?:token|password|secret|api[-_]?key|auth|access[-_]?token|refresh[-_]?token)=)[^&\s]+/gi, replacement: '$1<redacted>' },
  // Email addresses
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, replacement: '<email>' },
  // Home directories (macOS, Linux, Windows on any drive): the user name goes, the rest of the path stays readable
  { pattern: /\/Users\/[^/\s:"']+/g, replacement: '/Users/<user>' },
  { pattern: /\/home\/[^/\s:"']+/g, replacement: '/home/<user>' },
  { pattern: /([A-Za-z]:\\Users\\)[^\\\s:"']+/gi, replacement: '$1<user>' }
]

/** Replace every credential, e-mail address and home-directory user name in `value`. */
export function redactText(value: string): string {
  let out = value
  for (const { pattern, replacement } of REDACTION_RULES) {
    out = out.replace(pattern, replacement)
  }
  return out
}

/**
 * A manifest key whose value is withheld whatever it holds: a field added to a block the repro copies
 * as it is (the `modules` block) must not carry a credential out by being named like one.
 */
const SENSITIVE_KEY = /token|secret|password|passwd|credential|api[-_]?key|private[-_]?key|authorization|cookie/i

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key)
}

export const REDACTED_VALUE = '<redacted>'
