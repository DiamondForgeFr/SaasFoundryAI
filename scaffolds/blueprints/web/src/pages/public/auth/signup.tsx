/**
 * Resources
 */
import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'

/**
 * Components
 */
import { ThemeToggleButton } from '@/components/theme/theme-toggle-button'
import { AuthSuccessCard } from '@/components/ui/custom/auth-success-card'
import { FloatingLabelInput, FloatingLabelPasswordInput } from '@/components/ui/custom/floating-label-input'
import { Logo } from '@/components/ui/custom/logo'
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
import { useSignUp, useSignUpSchema, type SignUpPayloadDto } from '@/hooks/api/auth'

/**
 * React declaration
 */
export function SignUp() {
  const { t: tAuth } = useTranslation('auth')
  const { t: tCommon } = useTranslation('common')
  const [authError, setAuthError] = useState<string | null>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const flipClass = (location.state as { flip?: string })?.flip === 'right' ? 'auth-flip-right' : ''

  const signUpMutation = useSignUp()
  const isRegistered = signUpMutation.isSuccess

  const schemas = useSignUpSchema()
  const form = useForm<SignUpPayloadDto>({
    resolver: zodResolver(schemas.payload),
    defaultValues: { email: '', password: '' }
  })

  const onSubmit = (values: SignUpPayloadDto) => {
    setAuthError(null)
    signUpMutation.submit(
      { ...values },
      {
        onError: () => setAuthError(tAuth('signup.tk_authError_'))
      }
    )
  }

  const renderFormField = ({ name, label, type = 'text', autoComplete = '' }: { name: keyof SignUpPayloadDto; label: string; type?: string; autoComplete?: string }) => {
    const inputId = `input-${name}`
    return (
      <FormField
        control={form.control}
        name={name}
        render={({ field }) => (
          <FormItem>
            <FormControl>
              {name === 'password' ? (
                <FloatingLabelPasswordInput id={inputId} label={label} autoComplete={autoComplete} {...field} />
              ) : (
                <FloatingLabelInput id={inputId} label={label} type={type} autoComplete={autoComplete} {...field} />
              )}
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    )
  }

  if (isRegistered) {
    return (
      <AuthSuccessCard
        titleKey="signup.tk_successTitle_"
        descriptionKey="signup.tk_successDescription_"
        alertMessageKey="signup.tk_verifyEmailDescription_"
        alertMessageParams={{ userEmail: form.getValues('email') }}
        extraTextKey="signup.tk_checkSpam_"
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
            <h2 className="text-3xl font-bold tracking-tight text-foreground">{tAuth('signup.tk_title_')}</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">{tAuth('signup.tk_description_')}</p>
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
              {authError && (
                <Alert className="bg-destructive/10 text-destructive">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-5 w-5" />
                    <AlertDescription>{authError}</AlertDescription>
                  </div>
                </Alert>
              )}

              {renderFormField({
                name: 'email',
                label: tCommon('user.tk_email_'),
                type: 'email',
                autoComplete: 'email'
              })}

              {renderFormField({
                name: 'password',
                label: tAuth('fields.tk_password_'),
                autoComplete: 'new-password'
              })}

              <WaveButton type="submit" className="mt-7" disabled={signUpMutation.isLoading}>
                {signUpMutation.isLoading ? tCommon('loading.tk_loadingCreate_') : tAuth('callToAction.tk_signup_')}
              </WaveButton>

              <div className="flex items-center gap-3 my-4">
                <Separator className="flex-1" />
                <span className="text-xs text-muted-foreground">{tCommon('other.tk_or_')}</span>
                <Separator className="flex-1" />
              </div>

              <p className="text-center text-sm text-muted-foreground">
                Already here?{' '}
                <button type="button" onClick={() => navigate('/signin', { state: { flip: 'left' } })} className="cursor-pointer font-semibold text-primary hover:text-primary/80 transition-colors">
                  {tAuth('callToAction.tk_signin_')}
                </button>
              </p>
            </form>
          </Form>
        </div>
      </Card>
    </div>
  )
}
