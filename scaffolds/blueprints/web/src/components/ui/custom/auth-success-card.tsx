/**
 * Resources
 */
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

/**
 * Components
 */
import { Logo } from '@/components/ui/custom/logo'
import { ThemeToggleButton } from '@/components/theme/theme-toggle-button'
import { Card } from '@/components/ui/shadcn/card'

/**
 * Icons
 */
import { CheckCircle } from 'lucide-react'

type AuthSuccessCardProps = {
  titleKey: string
  descriptionKey: string
  alertMessageKey: string
  alertMessageParams?: Record<string, string>
  extraTextKey?: string
}

export function AuthSuccessCard({ titleKey, descriptionKey, alertMessageKey, alertMessageParams, extraTextKey }: AuthSuccessCardProps) {
  const { t: tAuth } = useTranslation('auth')
  const navigate = useNavigate()

  return (
    <div className="relative flex h-screen flex-col items-center bg-muted">
      <div className="absolute top-4 right-4">
        <ThemeToggleButton />
      </div>
      <Logo isLong className="max-w-xs px-4 py-20" />
      <Card className="glow-card auth-flip-right w-full max-w-md px-8 py-8">
        <div className="igw-glow" aria-hidden="true" />
        <div className="igw-border" aria-hidden="true" />
        <div className="relative z-10 flex flex-col items-center text-center space-y-5">
          {/* Icon */}
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10 ring-1 ring-emerald-500/30">
            <CheckCircle className="h-9 w-9 text-emerald-400" strokeWidth={1.5} />
          </div>

          {/* Title + description */}
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-foreground">{tAuth(titleKey)}</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">{tAuth(descriptionKey)}</p>
          </div>

          {/* Alert message — styled to match theme */}
          <div className="w-full rounded-sm border border-primary/20 bg-primary/8 px-4 py-3 text-sm text-foreground/80 text-left">{tAuth(alertMessageKey, alertMessageParams)}</div>

          {/* Extra text */}
          {extraTextKey && <p className="text-xs text-muted-foreground">{tAuth(extraTextKey)}</p>}

          {/* Back to sign in */}
          <button
            type="button"
            onClick={() => navigate('/signin', { state: { flip: 'left' } })}
            className="cursor-pointer pt-1 font-semibold text-primary hover:text-primary/80 transition-colors text-sm"
          >
            {tAuth('callToAction.tk_backToSignin_')}
          </button>
        </div>
      </Card>
    </div>
  )
}
