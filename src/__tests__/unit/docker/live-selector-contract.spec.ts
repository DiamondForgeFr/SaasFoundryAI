import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

describe('live journey selector contract', () => {
  it.each([
    ['platform modules', 'scaffolds/blueprints/web/src/pages/private/platform/platform-modules.tsx', ['module-card-', 'module-switch-']],
    ['role editor', 'scaffolds/blueprints/web/src/components/dialogs/create-role-dialog.tsx', ['role-editor', 'role-name', 'role-module-', 'role-section-', 'role-submit']],
    ['user invitation', 'scaffolds/blueprints/web/src/components/dialogs/invite-user-dialog.tsx', ['invite-user-dialog', 'invite-user-email', 'invite-user-submit']],
    ['account scope', 'scaffolds/blueprints/web/src/components/ui/custom/account-scope-header.tsx', ['account-status-switch']],
    [
      'reactivation request',
      'scaffolds/blueprints/web/src/pages/private/account/account-reactivation.tsx',
      ['reactivation-page', 'reactivation-request-form', 'reactivation-message', 'reactivation-submit']
    ],
    ['reactivation review', 'scaffolds/blueprints/web/src/pages/private/account/account-accounts.tsx', ['account-card-', 'reactivation-review-sheet', 'reactivation-approve', 'reactivation-reject']],
    ['rejection dialog', 'scaffolds/blueprints/web/src/components/dialogs/reject-reactivation-dialog.tsx', ['reactivation-reject-note', 'reactivation-reject-submit']],
    ['confirmation dialog', 'scaffolds/blueprints/web/src/components/ui/custom/confirm-dialog.tsx', ['confirm-dialog-confirm']]
  ])('keeps stable selectors for %s', async (_label, path, selectors) => {
    const source = await readFile(resolve(path), 'utf8')
    for (const selector of selectors) expect(source).toContain(selector)
  })
})
