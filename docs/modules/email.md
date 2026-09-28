# Email Module (MailerSend)

Transactional email powered by [MailerSend](https://mailersend.com).

## Overview

The email module wires a production-grade transactional email provider into the authentication flows of every generated project:

- ✅ **Three flows out of the box** — account confirmation, password reset, user invitation
- ✅ **i18n ready** — HTML + plain-text templates in English and French
- ✅ **Dev-friendly default** — without the module, rendered emails are logged to the console
- ✅ **Fully isolated** — emitted through a single `MailerSendService` so you can swap providers later
- ✅ **Test mode built in** — a fake API key in `.env.test` keeps E2E tests offline

## What the module actually ships

Every SaaSFoundryAI-generated project already contains the scaffolding for transactional email: the `EmailService`, the translation layer, and the six templates (HTML + text for each of the three
flows). What the module **adds** is the piece that puts bytes on the wire:

- **`MailerSendService`** — a thin wrapper around the `mailersend` npm SDK, wired with your API key and sender identity
- **Uncomments `TODO mailer-service-active:` markers** in `auth.service.ts`, `invitation.service.ts`, `env.service.ts` and `email.service.ts` — the real `sendEmail()` call replaces the dev-mode
  `console.log`
- **Registers the provider** in `email.module.ts`
- **Enables the E2E spec** by renaming `email.service.disabled-spec.ts` → `email.service.spec.ts`
- **Writes credentials** into `.env` (production values), `.env.test` (fake test key), and `.github/workflows/deployment.yml` (GitHub Actions secret reference)

This is why "without the module" is still useful: you can develop and sign users up locally without any third-party account — the emails just land in your server logs.

## Installation

### During project creation

```bash
sf new
# When prompted:
? Do you want to configure MailerSend for transactional emails?
→ Yes
? MailerSend API key:
→ ms_prod_abc123...
? Sender email:
→ noreply@myapp.com
? Sender name:
→ My SaaS App
```

### Adding it to an existing project

```bash
sf update --add-modules email \
  --mailersend-api-key    $MAILERSEND_KEY \
  --mailersend-sender-email noreply@myapp.com \
  --mailersend-sender-name  "My SaaS App"
```

Or run `sf update` interactively and pick **Email (MailerSend)** from the module menu.

The installer will:

1. Copy `mailersend.service.ts` to `apps/api/src/modules/email/services/`
2. Uncomment every `// TODO mailer-service-active:` marker across the affected services
3. Register `MailerSendService` as a provider in `EmailModule`
4. Rename the disabled unit test so it runs in CI
5. Replace the `# MAILERSEND_*=` placeholders in `.env`, `.env.test` and `deployment.yml` with real values

## Usage

### The three built-in flows

The module is wired in automatically — you do not call it directly in your business code. The three auth flows trigger it through the existing services:

| Flow                        | Triggered when                                   | Service                       | Template                           |
| --------------------------- | ------------------------------------------------ | ----------------------------- | ---------------------------------- |
| **Account confirmation**    | A user signs up (`POST /api/auth/signup`)        | `AuthService.signup()`        | `templates/account-confirmation/*` |
| **Password reset**          | A user requests a reset (`POST /api/auth/reset`) | `AuthService.resetPassword()` | `templates/password-reset/*`       |
| **Organisation invitation** | A member invites someone                         | `InvitationService.create()`  | `templates/invitation/*`           |

Each flow builds a `{baseUrl}?token=...` link and hands a fully rendered `{html, text}` pair to `EmailService`, which forwards it to `MailerSendService.sendEmail()`.

### Calling `EmailService` from your own modules

If you add your own flow (billing receipt, weekly digest, …) inject `EmailService` and call a method on it. The pattern follows the existing ones:

```typescript
import { EmailService } from '@modules/email/services/email.service'

@Injectable()
export class BillingService {
  constructor(private readonly emailService: EmailService) {}

  async sendReceipt(user: User, invoice: Invoice) {
    // Add a sendReceiptEmail method to EmailService following the existing ones,
    // then call it here. Keep translations in locales/{en,fr}.ts.
    await this.emailService.sendReceiptEmail(user.email, invoice.id, user.firstName, user.locale)
  }
}
```

Keep the `EmailService` as the public surface. `MailerSendService` is an implementation detail — do not inject it directly into business modules.

## Configuration

### Environment variables

Required in production (`apps/api/.env`):

```env
MAILERSEND_API_KEY="ms_prod_xxxxxxxxxxxxxxxxxxxxxxxx"
MAILERSEND_SENDER_EMAIL="noreply@myapp.com"
MAILERSEND_SENDER_NAME="My SaaS App"
```

The `FRONTEND_URL` variable (shared across the API) is used to build the confirmation / reset / invitation links:

```env
FRONTEND_URL="https://app.myapp.com"
```

### Test mode

`apps/api/.env.test` is populated with a deterministic fake key so the test suite never hits MailerSend:

```env
MAILERSEND_API_KEY="ms_test_fake_key_12345abcdef67890ghijklmnopqrstuvwxyz"
MAILERSEND_SENDER_EMAIL="noreply@myapp.com"
MAILERSEND_SENDER_NAME="My SaaS App"
```

The E2E suite stubs the MailerSend HTTP call; you can spy on it to assert an email was queued without sending anything.

### CI / deployment

`.github/workflows/deployment.yml` references the API key as a GitHub Actions secret. Set it once in your repo settings:

```bash
gh secret set MAILERSEND_API_KEY --body "$MAILERSEND_KEY"
```

The sender email and name are committed to the workflow file (they are not secrets). Change them there if your brand changes.

## Templates

Each flow ships two templates (HTML + plain text) and two locale files (EN + FR):

```
apps/api/src/modules/email/
├── locales/
│   ├── en.ts              # English strings (subjects, button labels, …)
│   └── fr.ts              # French strings
├── templates/
│   ├── account-confirmation/
│   │   ├── html.template.ts
│   │   └── text.template.ts
│   ├── password-reset/
│   │   ├── html.template.ts
│   │   └── text.template.ts
│   └── invitation/
│       ├── html.template.ts
│       └── text.template.ts
└── services/
    ├── email.service.ts          # Orchestrates render + send
    ├── mailersend.service.ts     # Added by the module
    └── translation.service.ts    # Picks strings by user locale
```

### Editing a template

1. Edit the `html.template.ts` and/or `text.template.ts` for the flow.
2. Add any new translation keys to **both** `locales/en.ts` and `locales/fr.ts`.
3. Run the unit test: `npm run test:unit -- email`.

### Adding a new locale

1. Create `locales/es.ts` (or whichever locale) alongside `en.ts` and `fr.ts`.
2. Import it in `translation.service.ts` and extend the dispatch map.
3. Add the locale to the Prisma `Locale` enum in `prisma/schema/user.prisma`, then run `npx prisma db push` to sync the enum into the dev DB.

## Local development without MailerSend

The module is **optional on purpose**. If you do not install it, every auth flow still works — the rendered HTML and text are `console.log`ed in the API server window. Use this during feature
development; install the module when you need real deliverability (staging, production, or when you want to click through a real link).

To force the dev-log behaviour even with the module installed (e.g. on a feature branch where you do not want to send real email), point `MAILERSEND_API_KEY` at the fake test key:

```env
MAILERSEND_API_KEY="ms_test_fake_key_12345abcdef67890ghijklmnopqrstuvwxyz"
```

MailerSend will reject the key, the `sendEmail()` call will throw, and your logs will show the failure — you will still see the rendered HTML in the debug log.

## MailerSend account setup

1. **Create an account**: https://www.mailersend.com/signup
2. **Verify a domain** under "Domains" — MailerSend will not deliver without a verified sender domain.
3. **Create an API token** under "Integrations → API tokens". Scope it to "Send email" for principle-of-least-privilege.
4. **Add a sender identity**: use `noreply@<your-verified-domain>` or similar. This is what `MAILERSEND_SENDER_EMAIL` points at.
5. Paste the token into `sf new` / `sf update --mailersend-api-key`.

## Troubleshooting

### Emails don't arrive in production

**Check** the API server logs for `MailerSendService` entries:

- `MailerSend error: ...` → inspect the error body. The two common causes are an unverified sender domain and a rate-limited API key.
- No log line at all → the module may not be installed. Grep for `MailerSendService` in `email.module.ts`. If it is absent, run `sf update --add-modules email ...`.
- `Message ID: ...` was logged but the mail is still missing → check the MailerSend dashboard "Activity" view. The recipient may have bounced or marked a previous send as spam.

### "Failed to send email: fetch failed"

The MailerSend API is unreachable from your server. Check:

- Outbound HTTPS to `api.mailersend.com` is allowed (corporate proxies, VPC egress rules).
- `MAILERSEND_API_KEY` is set (not `undefined` or a placeholder). The log on service init prints the first 5 chars of the key — if it shows `undefi`, the env var is missing.

### Test emails are being sent against a real account

You are running the non-test config against a live key. Verify `NODE_ENV=test` or your runner loads `.env.test`, not `.env`. The scaffolded Jest config already does this; if you changed it, switch
back.

### Templates look broken

Run the HTML through a real email client — inline CSS rules work differently than in a browser. MailerSend's preview (dashboard → "Email preview") and [mail-tester.com](https://www.mail-tester.com)
are good sanity checks before you push template changes.

## What happens when you run `sf update` on an email-enabled project

Because the installer uncomments markers and injects imports, the post-install state of several files differs from the untouched blueprint. The three-way merge in `sf update` handles this the same as
any other file: if you edit `email.service.ts` after install, subsequent updates treat your version as user-modified and will propose conflicts rather than re-applying the uncommenting.

The clean way to upgrade: keep your template customisations in the `locales/` and `templates/` folders (which the installer never touches), not in `email.service.ts` — the service file should stay
close to the blueprint so template updates apply cleanly.

## Next steps

- [Storage Module](/modules/storage) — file uploads paired with email links
- [Module System](/guide/module-system) — how modules compose
- [Updating Projects](/guide/updating-projects) — propagating template changes to your project

## Related commands

- [`sf new`](/cli/sf-new) — project creation with the email module
- [`sf update`](/cli/sf-update) — add the email module after the fact
