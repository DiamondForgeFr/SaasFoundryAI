/**
 * Resources
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Suspense, type ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Dependencies
 */
import { InviteAccountOwnerDialog } from '@/components/dialogs/invite-account-owner-dialog'
import i18n from '@/i18n'
import { SignIn } from '@/pages/public/auth/signin'
import { suggestAccountName } from '@/utils/account-name'

vi.mock('@/components/theme/theme-toggle-button', () => ({ ThemeToggleButton: () => null }))
vi.mock('@/hooks/auth/useModuleAccess', () => ({ useModuleAccess: () => ({ hasModuleAccess: () => false, awaitsPlatformAdmin: false }) }))
vi.mock('@/hooks/auth/useIsSession', () => ({ useIsSessionActive: () => ({ isSessionActive: false }) }))
vi.mock('@/hooks/api/invitations/queries/useInvitedUsers', () => ({ useInvitedUsers: () => ({ refetch: () => undefined }) }))

const renderApp = async (page: ReactNode) => {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { enabled: false } } })}>
      <MemoryRouter>
        <Suspense>{page}</Suspense>
      </MemoryRouter>
    </QueryClientProvider>
  )
  await waitFor(() => expect(document.querySelector('form')).toBeTruthy())
}

const confirmAccountToken = (payload: object) => `header.${btoa(JSON.stringify(payload))}.signature`
const switchTo = (language: string) => act(() => i18n.changeLanguage(language))
const input = (name: string) => document.querySelector<HTMLInputElement>(`[name="${name}"]`)!
const type = (name: string, value: string) => fireEvent.change(input(name), { target: { value } })
const expectAccountName = (expected: string) => waitFor(() => expect(input('accountName').value).toBe(expected))

beforeEach(() => i18n.changeLanguage('en'))
afterEach(() => window.history.replaceState({}, '', '/'))

/**
 * Declaration
 */
describe('suggestAccountName (#1081)', () => {
  beforeAll(() => i18n.loadLanguages(['en', 'fr']))

  it.each([
    [{ firstname: 'bob', lastname: 'martin' }, "Bob Martin's account", 'Compte de Bob Martin'],
    [{ firstname: ' Alice ', lastname: ' Martin ' }, "Alice Martin's account", "Compte d'Alice Martin"],
    [{ firstname: 'Élodie' }, "Élodie's account", "Compte d'Élodie"],
    [{ firstname: 'Œdipe' }, "Œdipe's account", "Compte d'Œdipe"],
    [{ firstname: 'Yves' }, "Yves's account", "Compte d'Yves"],
    [{ firstname: 'Yann' }, "Yann's account", 'Compte de Yann'],
    [{ firstname: 'Hugo' }, "Hugo's account", 'Compte de Hugo'],
    [{ lastname: 'Martin', email: 'olga.martin+test@example.test' }, "Olga's account", "Compte d'Olga"],
    [{ email: 'not an address' }, 'Main account', 'Compte principal'],
    [{ email: '.martin@example.test' }, 'Main account', 'Compte principal'],
    [{}, 'Main account', 'Compte principal']
  ])('%j', (owner, english, french) => {
    expect(suggestAccountName(i18n.getFixedT('en', 'common'), owner)).toBe(english)
    expect(suggestAccountName(i18n.getFixedT('fr', 'common'), owner)).toBe(french)
  })
})

describe('the account name suggested by a form (#1081)', () => {
  const forms = [
    {
      form: 'the account activation',
      open: () => {
        window.history.replaceState({}, '', `/signin?confirmAccountToken=${confirmAccountToken({ firstname: 'Alice', lastname: 'Martin', email: 'alice@example.test' })}`)
        return renderApp(<SignIn />)
      }
    },
    {
      form: 'the account owner invitation',
      open: async () => {
        await renderApp(<InviteAccountOwnerDialog isOpen onOpenChange={() => undefined} />)
        type('firstname', 'Alice')
        type('lastname', 'Martin')
      }
    }
  ]

  it.each(forms)('$form: follows the language', async ({ open }) => {
    await open()
    await expectAccountName("Alice Martin's account")

    await switchTo('fr')

    await expectAccountName("Compte d'Alice Martin")
    type('firstname', 'Bob')
    await expectAccountName('Compte de Bob Martin')
  })

  it.each(forms)('$form: keeps the name the user typed when the language or the person changes', async ({ open }) => {
    await open()
    await expectAccountName("Alice Martin's account")
    type('accountName', 'Acme')

    await switchTo('fr')
    type('firstname', 'Bob')

    await screen.findByText(/Suggéré automatiquement/)
    expect(input('firstname').value).toBe('Bob')
    expect(input('accountName').value).toBe('Acme')
  })

  it.each(forms)('$form: does not fill again a field the user just cleared', async ({ open }) => {
    await open()
    await expectAccountName("Alice Martin's account")
    type('accountName', '')

    await act(async () => undefined)
    expect(input('accountName').value).toBe('')
  })
})
