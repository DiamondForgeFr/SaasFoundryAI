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
import { FloatingLabelInput } from '@/components/ui/custom/floating-label-input'
import { Logo } from '@/components/ui/custom/logo'
import { WaveButton } from '@/components/ui/custom/wave-button'
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert'
import { Card } from '@/components/ui/shadcn/card'
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/shadcn/form'
import { Separator } from '@/components/ui/shadcn/separator'

/**
 * API
 */
import { useRequestPasswordReset, useRequestPasswordResetSchema, type RequestPasswordResetPayloadDto } from '@/hooks/api/auth'

/**
 * React declaration
 */
export function ResetPasswordRequest() {
  const { t: tAuth } = useTranslation('auth')
  const { t: tCommon } = useTranslation('common')
  const [userEmail, setUserEmail] = useState('')
  const navigate = useNavigate()
  const location = useLocation()
  const flipClass = (location.state as { flip?: string })?.flip === 'up' ? 'auth-flip-right' : ''

  const resetPasswordMutation = useRequestPasswordReset()
  const isSubmitted = resetPasswordMutation.isSuccess

  const schemas = useRequestPasswordResetSchema()
  const form = useForm<RequestPasswordResetPayloadDto>({
    resolver: zodResolver(schemas.payload),
    defaultValues: { email: '' }
  })

  const onSubmit = (values: RequestPasswordResetPayloadDto) => {
    setUserEmail(values.email)
    resetPasswordMutation.submit(values)
  }

  if (isSubmitted) {
    return (
      <AuthSuccessCard
        titleKey="resetPasswordRequest.tk_successTitle_"
        descriptionKey="resetPasswordRequest.tk_successDescription_"
        alertMessageKey="resetPasswordRequest.tk_verifyResetPasswordDescription_"
        alertMessageParams={{ userEmail }}
        extraTextKey="resetPasswordRequest.tk_checkSpam_"
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
            <h2 className="text-3xl font-bold tracking-tight text-foreground">{tAuth('resetPasswordRequest.tk_title_')}</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">{tAuth('resetPasswordRequest.tk_description_')}</p>
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
              {resetPasswordMutation.isError && (
                <Alert className="bg-destructive/10 text-destructive">
                  <AlertDescription>{tAuth('resetPasswordRequest.tk_errorMessage_')}</AlertDescription>
                </Alert>
              )}

              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <FloatingLabelInput label={tCommon('user.tk_email_')} type="email" autoComplete="email" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <WaveButton type="submit" className="mt-7" disabled={resetPasswordMutation.isLoading}>
                {resetPasswordMutation.isLoading ? tCommon('loading.tk_loadingSend_') : tAuth('callToAction.tk_sendResetPasswordLink_')}
              </WaveButton>

              <div className="flex items-center gap-3 my-4">
                <Separator className="flex-1" />
                <span className="text-xs text-muted-foreground">or</span>
                <Separator className="flex-1" />
              </div>

              <p className="text-center text-sm text-muted-foreground">
                <button type="button" onClick={() => navigate('/signin', { state: { flip: 'left' } })} className="cursor-pointer font-semibold text-primary hover:text-primary/80 transition-colors">
                  {tAuth('callToAction.tk_backToSignin_')}
                </button>
              </p>
            </form>
          </Form>
        </div>
      </Card>
    </div>
  )
}
