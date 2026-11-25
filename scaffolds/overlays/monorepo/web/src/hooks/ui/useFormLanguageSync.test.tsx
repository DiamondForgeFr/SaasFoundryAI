/**
 * Resources
 */
import { zodResolver } from '@hookform/resolvers/zod'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Suspense, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

/**
 * Dependencies
 */
import { CreateEntityDialog } from '@/components/dialogs/create-entity-dialog'
import { useFormLanguageSync } from '@/hooks/ui/useFormLanguageSync'
import i18n from '@/i18n'
import { SignUp } from '@/pages/public/auth/signup'

vi.mock('@/components/theme/theme-toggle-button', () => ({ ThemeToggleButton: () => null }))
vi.mock('@/hooks/auth/useModuleAccess', () => ({ useModuleAccess: () => ({ hasPermission: () => true }) }))
vi.mock('@/hooks/auth/useAdminScope', () => ({ useAdminScope: () => ({ activeEntity: undefined, managedEntities: [] }) }))

const renderApp = (page: ReactNode) => {
  const queryClient = new QueryClient()
  queryClient.setQueryData(['authMe'], { accounts: [{ id: 'account-1', isActive: true }] })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Suspense>{page}</Suspense>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

const switchTo = (language: string) => act(() => i18n.changeLanguage(language))
const submitForm = () => fireEvent.submit(document.querySelector('form')!)
const type = (name: string, value: string) => fireEvent.change(document.querySelector(`[name="${name}"]`)!, { target: { value } })

beforeEach(() => i18n.changeLanguage('en'))

/**
 * Declaration
 */
describe('validation messages follow the current language (#983)', () => {
  it('translates the errors already displayed by a page', async () => {
    renderApp(<SignUp />)
    await waitFor(() => expect(document.querySelector('form')).toBeTruthy())
    submitForm()
    expect(await screen.findByText('Email is required')).toBeTruthy()

    await switchTo('fr')

    expect(await screen.findByText("L'email est requis")).toBeTruthy()
    expect(screen.getByText('Le mot de passe doit contenir au moins 8 caractères')).toBeTruthy()
    expect(screen.queryByText('Email is required')).toBeNull()
  })

  it('translates a nested field error of a dialog mounted before the locale was applied', async () => {
    renderApp(<CreateEntityDialog isOpen onOpenChange={() => undefined} />)
    await waitFor(() => expect(document.querySelector('form')).toBeTruthy())
    type('organization.name', 'Acme')
    type('organization.website', 'not a url')
    submitForm()
    expect(await screen.findByText('Invalid URL — must include http:// or https://')).toBeTruthy()

    await switchTo('fr')

    expect(await screen.findByText('URL invalide — doit inclure http:// ou https://')).toBeTruthy()
    expect(screen.queryByText('Invalid URL — must include http:// or https://')).toBeNull()
  })

  it('validates in the new language a form that displayed no error before the switch', async () => {
    renderApp(<SignUp />)
    await waitFor(() => expect(document.querySelector('form')).toBeTruthy())

    await switchTo('fr')
    expect(screen.queryByText("L'email est requis")).toBeNull()
    submitForm()

    expect(await screen.findByText("L'email est requis")).toBeTruthy()
  })
})

describe('useFormLanguageSync', () => {
  function Harness() {
    const { t } = useTranslation('common')
    const required = t('fields.errors.tk_required_')
    const schema = z.object({ type: z.string().min(1, { message: required }), other: z.string().min(1, { message: required }) })
    const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { type: '', other: '' } })
    useFormLanguageSync(form, { refused: t('fields.errors.tk_minLength_') })
    const { errors } = form.formState

    return (
      <form>
        <input {...form.register('type')} />
        <input {...form.register('other')} />
        <p data-testid="type">{errors.type?.message}</p>
        <p data-testid="other">{errors.other?.message}</p>
        <button type="button" onClick={() => form.trigger('type')}>
          validate
        </button>
        <button type="button" onClick={() => form.setError('other', { type: 'refused', message: t('fields.errors.tk_minLength_') })}>
          refuse
        </button>
      </form>
    )
  }

  const english = (key: string) => i18n.getFixedT('en', 'common')(key)
  const french = (key: string) => i18n.getFixedT('fr', 'common')(key)
  const textOf = (testId: string) => screen.getByTestId(testId).textContent

  it('validates again only the fields that display an error', async () => {
    renderApp(<Harness />)
    fireEvent.click(await screen.findByText('validate'))
    await waitFor(() => expect(textOf('type')).toBe(english('fields.errors.tk_required_')))

    await switchTo('fr')

    await waitFor(() => expect(textOf('type')).toBe(french('fields.errors.tk_required_')))
    expect(french('fields.errors.tk_required_')).not.toBe(english('fields.errors.tk_required_'))
    expect(textOf('other')).toBe('')
  })

  it('keeps and translates an error the form set itself', async () => {
    renderApp(<Harness />)
    fireEvent.click(await screen.findByText('refuse'))
    await waitFor(() => expect(textOf('other')).toBe(english('fields.errors.tk_minLength_')))

    await switchTo('fr')

    await waitFor(() => expect(textOf('other')).toBe(french('fields.errors.tk_minLength_')))
    expect(french('fields.errors.tk_minLength_')).not.toBe(english('fields.errors.tk_minLength_'))
  })
})
