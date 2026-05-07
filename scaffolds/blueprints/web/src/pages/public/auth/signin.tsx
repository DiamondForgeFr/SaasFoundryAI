/**
 * Resources
 */
import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'

/**
 * Dependencies
 */
import { useIsSessionActive } from '@/hooks/auth/useIsSession'
import { useModuleAccess } from '@/hooks/auth/useModuleAccess'
import { decodeJwtPayload } from '@/hooks/auth/useTokenDecoder'
import { extractTokenFromUrl } from '@/utils/tokenExtractor'

/**
 * Components
 */
import { ThemeToggleButton } from '@/components/theme/theme-toggle-button'
import { Logo } from '@/components/ui/custom/logo'
import { FloatingLabelInput, FloatingLabelPasswordInput } from '@/components/ui/custom/floating-label-input'
import { WaveButton } from '@/components/ui/custom/wave-button'
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert'
import { Card } from '@/components/ui/shadcn/card'
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/shadcn/form'
import { Separator } from '@/components/ui/shadcn/separator'

/**
 * Icons
 */
import { AlertCircle } from 'lucide-react'

/**
 * API
 */
import { useSignIn, useSignInSchema, type SignInPayloadDto } from '@/hooks/api/auth'

/**
 * React declaration
 */
export function SignIn() {
  const navigate = useNavigate()
  const location = useLocation()
  const flipClass = (location.state as { flip?: string })?.flip === 'left' ? 'auth-flip-left' : ''
  const { t: tAuth } = useTranslation('auth')
  const { t: tCommon } = useTranslation('common')
  const [authError, setAuthError] = useState<string | null>(null)
  const [confirmAccountToken] = useState(() => extractTokenFromUrl('confirmAccountToken'))

  // Decode token once on mount
  const tokenData = confirmAccountToken ? decodeJwtPayload<{ firstname?: string; lastname?: string; email?: string }>(confirmAccountToken) : null
  const isFirstLogin = !!confirmAccountToken

  // React Query mutation
  const signInMutation = useSignIn()
  const { isSessionActive } = useIsSessionActive()
  const { hasModuleAccess } = useModuleAccess()

  // Create form with schema
  const schemas = useSignInSchema()
  const form = useForm<SignInPayloadDto>({
    resolver: zodResolver(schemas.payload),
    defaultValues: {
      email: tokenData?.email || '',
      password: '',
      firstname: tokenData?.firstname || '',
      lastname: tokenData?.lastname || ''
    }
  })

  // Redirect on successful login
  useEffect(() => {
    if (signInMutation.isSuccess || isSessionActive) navigate('/dashboard')
  }, [isSessionActive, signInMutation.isSuccess, navigate])

  const onSubmit = (values: SignInPayloadDto) => {
    setAuthError(null)

    // Prepare payload
    const payload: SignInPayloadDto = {
      email: values.email,
      password: values.password
    }

    // Only add confirmAccountToken and user info if token exists
    if (confirmAccountToken) {
      payload.confirmAccountToken = confirmAccountToken

      // If it's the first login with the token, add the profile information
      if (isFirstLogin && values.firstname && values.lastname) {
        payload.firstname = values.firstname
        payload.lastname = values.lastname
      }
    }

    // Use React Query mutation
    signInMutation.submit(payload, {
      onError: () => {
        setAuthError(tAuth('signin.tk_authError_'))
      }
    })
  }

  // Reusable form field
  const renderFormField = ({ name, label, type = 'text', autoComplete = '', tabIndex }: { name: keyof SignInPayloadDto; label: string; type?: string; autoComplete?: string; tabIndex?: number }) => {
    const inputId = `input-${name}`
    return (
      <FormField
        control={form.control}
        name={name}
        render={({ field }) => (
          <FormItem>
            <FormControl>
              {name === 'password' ? (
                <FloatingLabelPasswordInput id={inputId} label={label} autoComplete={autoComplete} tabIndex={tabIndex} {...field} />
              ) : (
                <FloatingLabelInput id={inputId} label={label} type={type} autoComplete={autoComplete} tabIndex={tabIndex} {...field} />
              )}
            </FormControl>
            {name === 'password' && hasModuleAccess('USER_ACCOUNT_PASSWORD_RECOVERY') && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => navigate('/reset-password-request', { state: { flip: 'up' } })}
                  className="cursor-pointer text-xs text-muted-foreground hover:text-primary transition-colors"
                >
                  {tAuth('callToAction.tk_forgotPassword_')}
                </button>
              </div>
            )}
            <FormMessage />
          </FormItem>
        )}
      />
    )
  }

  return (
    <div className="relative flex h-screen flex-col items-center bg-muted">
      <div className="absolute top-4 right-4">
        <ThemeToggleButton />
      </div>
      <Logo isLong className="max-w-xs px-4 py-20" />
      <Card className={`glow-card w-full max-w-md px-8 py-8 ${flipClass}`}>
        <div className="igw-glow" aria-hidden="true" />
        <div className="igw-border" aria-hidden="true" />
        <div className="relative z-10">
          <div className="text-center mb-6">
            <h2 className="text-3xl font-bold tracking-tight text-foreground">{tAuth('signin.tk_title_')}</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">{tAuth('signin.tk_description_')}</p>
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
              {(authError || signInMutation.isError) && (
                <Alert className="bg-destructive/10 text-destructive">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-5 w-5" />
                    <AlertDescription>{authError || tAuth('signin.tk_authError_')}</AlertDescription>
                  </div>
                </Alert>
              )}

              {isFirstLogin && confirmAccountToken && (
                <div className="grid grid-cols-2 gap-4">
                  {renderFormField({
                    name: 'firstname',
                    label: tCommon('user.tk_firstName_'),
                    tabIndex: 1
                  })}
                  {renderFormField({
                    name: 'lastname',
                    label: tCommon('user.tk_lastName_'),
                    tabIndex: 2
                  })}
                </div>
              )}

              {renderFormField({
                name: 'email',
                label: tCommon('user.tk_email_'),
                type: 'email',
                autoComplete: 'email',
                tabIndex: isFirstLogin ? 3 : 1
              })}
              {renderFormField({
                name: 'password',
                label: tAuth('fields.tk_password_'),
                type: 'password',
                autoComplete: 'current-password',
                tabIndex: isFirstLogin ? 4 : 2
              })}

              <WaveButton type="submit" className="mt-7" disabled={signInMutation.isLoading} tabIndex={isFirstLogin ? 5 : 3}>
                {signInMutation.isLoading ? tCommon('loading.tk_loadingSignin_') : tAuth('callToAction.tk_signin_')}
              </WaveButton>

              {hasModuleAccess('USER_ACCOUNT_CREATION') && (
                <>
                  <div className="flex items-center gap-3 my-4">
                    <Separator className="flex-1" />
                    <span className="text-xs text-muted-foreground">{tCommon('other.tk_or_')}</span>
                    <Separator className="flex-1" />
                  </div>

                  <p className="text-center text-sm text-muted-foreground">
                    New here?{' '}
                    <button
                      type="button"
                      onClick={() => navigate('/signup', { state: { flip: 'right' } })}
                      className="cursor-pointer font-semibold text-primary hover:text-primary/80 transition-colors"
                    >
                      {tAuth('callToAction.tk_signup_')}
                    </button>
                  </p>
                </>
              )}
            </form>
          </Form>
        </div>
      </Card>
    </div>
  )
}
