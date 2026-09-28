/**
 * Resources
 */
import { extractTokenFromUrl } from '@/utils/tokenExtractor'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

/**
 * Components
 */
import { ThemeToggleButton } from '@/components/theme/theme-toggle-button'
import { AuthSuccessCard } from '@/components/ui/custom/auth-success-card'
import { FloatingLabelPasswordInput } from '@/components/ui/custom/floating-label-input'
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
import { useResetPassword, useResetPasswordSchema, type ResetPasswordPayloadDto } from '@/hooks/api/auth'

/**
 * React declaration
 */
export function ResetPassword() {
  const { t: tAuth } = useTranslation('auth')
  const { t: tCommon } = useTranslation('common')
  const navigate = useNavigate()
  const [resetPasswordToken] = useState(() => extractTokenFromUrl('resetPasswordToken'))

  const resetPasswordMutation = useResetPassword()
  const isPasswordReset = resetPasswordMutation.isSuccess

  const tokenError = useMemo(() => {
    if (!resetPasswordToken) return tAuth('resetPassword.tk_missingTokenError_')
    if (resetPasswordToken.length < 20) return tAuth('resetPassword.tk_invalidTokenError_')
    return null
  }, [resetPasswordToken, tAuth])

  const schemas = useResetPasswordSchema()
  const form = useForm<ResetPasswordPayloadDto>({
    resolver: zodResolver(schemas.payload),
    defaultValues: {
      resetPasswordToken: resetPasswordToken || '',
      password: '',
      confirmPassword: ''
    }
  })

  const onSubmit = (values: ResetPasswordPayloadDto) => {
    resetPasswordMutation.submit(values)
  }

  if (isPasswordReset) {
    return <AuthSuccessCard titleKey="resetPassword.tk_successTitle_" descriptionKey="resetPassword.tk_successDescription_" alertMessageKey="resetPassword.tk_verifyPasswordUpdatedDescription_" />
  }

  return (
    <div className="relative flex h-screen flex-col items-center bg-muted">
      <div className="absolute top-4 right-4">
        <ThemeToggleButton />
      </div>
      <Logo isLong className="max-w-xs px-4 py-20" />
      <Card className="glow-card auth-flip-right w-full max-w-md px-8 py-8">
        <div className="igw-glow" aria-hidden="true" />
        <div className="igw-border" aria-hidden="true" />
        <div className="relative z-10">
          <div className="text-center mb-6">
            <h2 className="text-3xl font-bold tracking-tight text-foreground">{tAuth('resetPassword.tk_title_')}</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">{tAuth('resetPassword.tk_description_')}</p>
          </div>

          {tokenError ? (
            <div className="space-y-4">
              <Alert className="bg-destructive/10 text-destructive">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-5 w-5" />
                  <AlertDescription>{tokenError}</AlertDescription>
                </div>
              </Alert>
              <p className="text-center text-sm text-muted-foreground">
                <button
                  type="button"
                  onClick={() => navigate('/reset-password-request', { state: { flip: 'up' } })}
                  className="cursor-pointer font-semibold text-primary hover:text-primary/80 transition-colors"
                >
                  {tAuth('callToAction.tk_askForNewLink_')}
                </button>
              </p>
            </div>
          ) : (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
                {resetPasswordMutation.isError && (
                  <Alert className="bg-destructive/10 text-destructive">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="h-5 w-5" />
                      <AlertDescription>{tAuth('resetPassword.tk_invalidTokenError_')}</AlertDescription>
                    </div>
                  </Alert>
                )}

                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <FloatingLabelPasswordInput label={tAuth('fields.tk_newPassword_')} autoComplete="new-password" tabIndex={1} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <FloatingLabelPasswordInput label={tAuth('fields.tk_confirmPassword_')} autoComplete="new-password" tabIndex={2} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <WaveButton type="submit" className="mt-7" disabled={resetPasswordMutation.isLoading} tabIndex={3}>
                  {resetPasswordMutation.isLoading ? tCommon('loading.tk_loadingUpdate_') : tAuth('callToAction.tk_updatePassword_')}
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
          )}
        </div>
      </Card>
    </div>
  )
}
