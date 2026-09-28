/**
 * Resources
 */
import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

/**
 * Dependencies
 */
import { decodeJwtPayload } from '@/hooks/auth/useTokenDecoder'
import { extractTokenFromUrl } from '@/utils/tokenExtractor'

/**
 * Components
 */
import { ThemeToggleButton } from '@/components/theme/theme-toggle-button'
import { FloatingLabelInput, FloatingLabelPasswordInput } from '@/components/ui/custom/floating-label-input'
import { Logo } from '@/components/ui/custom/logo'
import { WaveButton } from '@/components/ui/custom/wave-button'
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert'
import { Card } from '@/components/ui/shadcn/card'
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/shadcn/form'

/**
 * Icons
 */
import { AlertCircle } from 'lucide-react'

/**
 * API
 */
import { useAcceptUserInvitation, useAcceptUserInvitationSchema, type AcceptUserInvitationPayloadDto } from '@/hooks/api/invitations/mutations/useAcceptUserInvitation'

/**
 * React declaration
 */
export function UserInvitation() {
  const navigate = useNavigate()
  const { t: tAuth } = useTranslation('auth')
  const { t: tCommon } = useTranslation('common')
  const [invitationError, setInvitationError] = useState<string | null>(null)
  const [invitationToken] = useState(() => extractTokenFromUrl('invitationToken'))
  const [countdown, setCountdown] = useState(5)

  const tokenData = invitationToken ? decodeJwtPayload<{ firstname?: string; lastname?: string }>(invitationToken) : null

  const acceptInvitationMutation = useAcceptUserInvitation()

  const schemas = useAcceptUserInvitationSchema()
  const form = useForm<AcceptUserInvitationPayloadDto>({
    resolver: zodResolver(schemas.payload),
    defaultValues: {
      invitationToken: invitationToken || '',
      password: '',
      firstname: tokenData?.firstname || '',
      lastname: tokenData?.lastname || ''
    }
  })

  useEffect(() => {
    if (!invitationToken) {
      const timer = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(timer)
            navigate('/signin')
            return 0
          }
          return prev - 1
        })
      }, 1000)
      return () => clearInterval(timer)
    }
  }, [invitationToken, navigate])

  const onSubmit = (values: AcceptUserInvitationPayloadDto) => {
    setInvitationError(null)
    acceptInvitationMutation.submit(values, {
      onSuccess: () => navigate('/dashboard'),
      onError: () => setInvitationError(tAuth('errors.tk_acceptInvitationError_'))
    })
  }

  /* ── No token — countdown card ── */
  if (!invitationToken) {
    return (
      <div className="relative flex h-screen flex-col items-center bg-muted">
        <div className="absolute top-4 right-4">
          <ThemeToggleButton />
        </div>
        <Logo isLong className="max-w-xs px-4 py-20" />
        <Card className="glow-card auth-flip-right w-full max-w-md px-8 py-8">
          <div className="igw-glow" aria-hidden="true" />
          <div className="igw-border" aria-hidden="true" />
          <div className="relative z-10 text-center space-y-3">
            <h2 className="text-2xl font-bold tracking-tight text-foreground">{tAuth('userInvitation.tk_acceptInvitationError_')}</h2>
            <p className="text-sm text-muted-foreground">{tAuth('userInvitation.tk_redirecting_', { countdown })}</p>
          </div>
        </Card>
      </div>
    )
  }

  /* ── Invitation form ── */
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
            <h2 className="text-3xl font-bold tracking-tight text-foreground">{tAuth('userInvitation.tk_title_')}</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">{tAuth('userInvitation.tk_descriptionInvitation_')}</p>
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
              {(invitationError || acceptInvitationMutation.isError) && (
                <Alert className="bg-destructive/10 text-destructive">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-5 w-5" />
                    <AlertDescription>{invitationError || tAuth('errors.tk_acceptInvitationError_')}</AlertDescription>
                  </div>
                </Alert>
              )}

              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="firstname"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <FloatingLabelInput label={tCommon('user.tk_firstName_')} autoComplete="given-name" tabIndex={1} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="lastname"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <FloatingLabelInput label={tCommon('user.tk_lastName_')} autoComplete="family-name" tabIndex={2} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <FloatingLabelPasswordInput label={tAuth('fields.tk_newPassword_')} autoComplete="new-password" tabIndex={3} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <WaveButton type="submit" className="mt-7" disabled={acceptInvitationMutation.isLoading} tabIndex={4}>
                {acceptInvitationMutation.isLoading ? tCommon('loading.tk_loading_') : tAuth('callToAction.tk_accept_')}
              </WaveButton>
            </form>
          </Form>
        </div>
      </Card>
    </div>
  )
}
