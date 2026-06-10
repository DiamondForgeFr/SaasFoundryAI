/**
 * Resources
 */
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate } from 'react-router-dom'

/**
 * Dependencies
 */
import { useCreateReactivationRequest } from '@/hooks/api/accounts/mutations/useCreateReactivationRequest'
import { useLatestReactivationRequest } from '@/hooks/api/accounts/queries/useLatestReactivationRequest'
import { useAdminScope } from '@/hooks/auth/useAdminScope'
import { useBreadcrumb } from '@/hooks/ui/useBreadcrumb'
import { AlertCircle, CheckCircle2, Clock, PowerOff, ShieldAlert } from 'lucide-react'

/**
 * Components
 */
import { WaveButton } from '@/components/ui/custom/wave-button'
import { cn } from '@/utils/ui'
import { Skeleton } from '@/components/ui/shadcn/skeleton'

import { formatDateLong } from '@/utils/format'

/**
 * Page reached when an account-admin has only disabled accounts. The reactivation request
 * workflow is available regardless of who triggered the deactivation:
 *
 *   - `deactivatedByScope === 'ACCOUNT_OWNER'` → standard self-reactivation flow.
 *   - `deactivatedByScope === 'PLATFORM'` → an info banner is shown to remind the user that
 *     a platform admin disabled the account, but they can still file a request explaining
 *     the situation. The platform admin reviews and approves/rejects as usual.
 *
 * Platform-admins are redirected away by `AccountDisabledRoute`, so they should never
 * land here in the normal flow; if they do (manual URL), bounce to the dashboard.
 */
export function AccountReactivation() {
  const { t: tAccount } = useTranslation('account')
  const { t: tCommon } = useTranslation('common')
  const { setBreadcrumb } = useBreadcrumb()
  const { isPlatformAdmin, allAccounts } = useAdminScope()

  // Pick the first disabled account the user belongs to (most users have one anyway).
  const disabledAccount = useMemo(() => allAccounts.find((a) => !a.isActive) ?? null, [allAccounts])
  const accountId = disabledAccount?.id ?? null

  const { data: latest, isLoading: isLoadingLatest } = useLatestReactivationRequest(accountId)
  const createRequest = useCreateReactivationRequest()

  const [message, setMessage] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    setBreadcrumb([{ label: tAccount('reactivation.tk_breadcrumb_'), description: tAccount('reactivation.tk_breadcrumb-description_') }])
  }, [setBreadcrumb, tAccount])

  // Platform-admin or no disabled account at all → not the right place.
  if (isPlatformAdmin) return <Navigate to="/dashboard" replace />
  if (allAccounts.length > 0 && !disabledAccount) return <Navigate to="/dashboard" replace />

  if (!disabledAccount) {
    return (
      <div className="container mx-auto py-12 max-w-xl text-center">
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  const isPlatformDeactivated = disabledAccount.deactivatedByScope === 'PLATFORM'
  const hasPendingRequest = latest?.status === 'PENDING'
  const wasRejected = latest?.status === 'REJECTED'

  const submit = async () => {
    setSubmitError(null)
    if (message.trim().length < 10) {
      setSubmitError(tAccount('reactivation.tk_min-message_'))
      return
    }
    try {
      await createRequest.mutateAsync({ accountId: disabledAccount.id, message: message.trim() })
      setMessage('')
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : tAccount('reactivation.tk_submit-error_'))
    }
  }

  return (
    <div className="container mx-auto py-10 max-w-2xl">
      {/* Headline state card */}
      <div className="rounded-sm border border-border bg-card p-6 mb-6">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-amber-500/15">
            <PowerOff className="h-6 w-6 text-amber-500" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold text-foreground tracking-tight">{tAccount('reactivation.tk_title_', { name: disabledAccount.name })}</h1>
            <p className="text-[12px] text-muted-foreground mt-1">{tAccount('reactivation.tk_subtitle_')}</p>
          </div>
        </div>
      </div>

      {/* Informational banner when a platform-admin triggered the deactivation */}
      {isPlatformDeactivated && (
        <div className="rounded-sm border border-border bg-muted/40 p-5 mb-6">
          <div className="flex items-start gap-3">
            <ShieldAlert className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
            <div>
              <div className="text-[13px] font-semibold text-foreground">{tAccount('reactivation.platform.tk_title_')}</div>
              <p className="text-[12px] text-muted-foreground mt-1">{tAccount('reactivation.platform.tk_description_')}</p>
            </div>
          </div>
        </div>
      )}

      {/* Reactivation request flow — available regardless of deactivation scope */}
      {isLoadingLatest && <Skeleton className="h-32 w-full" />}

      {/* Pending request — show status + when submitted */}
      {!isLoadingLatest && hasPendingRequest && latest && (
        <div className="rounded-sm border border-amber-500/40 bg-amber-500/5 p-5">
          <div className="flex items-start gap-3">
            <Clock className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-amber-500">{tAccount('reactivation.pending.tk_title_')}</div>
              <p className="text-[12px] text-muted-foreground mt-1">{tAccount('reactivation.pending.tk_description_', { date: formatDateLong(latest.createdAt) })}</p>
              <div className="mt-3 rounded-sm border border-border bg-card p-3">
                <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">{tAccount('reactivation.tk_your-message_')}</div>
                <p className="text-[12px] text-foreground whitespace-pre-wrap">{latest.message}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Rejected — show reason + allow resubmitting */}
      {!isLoadingLatest && wasRejected && latest && (
        <div className="rounded-sm border border-destructive/40 bg-destructive/5 p-5 mb-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-destructive">{tAccount('reactivation.rejected.tk_title_')}</div>
              <p className="text-[12px] text-muted-foreground mt-1">{tAccount('reactivation.rejected.tk_description_', { date: latest.reviewedAt ? formatDateLong(latest.reviewedAt) : '—' })}</p>
              {latest.reviewNote && (
                <div className="mt-3 rounded-sm border border-border bg-card p-3">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">{tAccount('reactivation.rejected.tk_review-note_')}</div>
                  <p className="text-[12px] text-foreground whitespace-pre-wrap">{latest.reviewNote}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Approved (rare — should redirect) — show success ribbon */}
      {!isLoadingLatest && latest?.status === 'APPROVED' && (
        <div className="rounded-sm border border-emerald-500/40 bg-emerald-500/5 p-5 mb-6">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 flex-shrink-0" />
            <div>
              <div className="text-[13px] font-semibold text-emerald-500">{tAccount('reactivation.approved.tk_title_')}</div>
              <p className="text-[12px] text-muted-foreground mt-1">{tAccount('reactivation.approved.tk_description_')}</p>
            </div>
          </div>
        </div>
      )}

      {/* Submission form — visible when no pending request */}
      {!isLoadingLatest && !hasPendingRequest && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
          className="rounded-sm border border-border bg-card p-5"
        >
          <label htmlFor="reactivation-message" className="block text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
            {tAccount('reactivation.form.tk_label_')}
          </label>
          <p className="text-[12px] text-muted-foreground mb-3">{tAccount('reactivation.form.tk_help_')}</p>
          <textarea
            id="reactivation-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={6}
            maxLength={2000}
            placeholder={tAccount('reactivation.form.tk_placeholder_')}
            className={cn(
              'w-full rounded-sm border border-border bg-background p-3 text-[13px] text-foreground',
              'placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-colors resize-y'
            )}
          />
          <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
            <span className={cn(message.trim().length < 10 ? 'text-destructive' : 'text-muted-foreground')}>{tAccount('reactivation.form.tk_char-count_', { count: message.length })}</span>
            <span>{tAccount('reactivation.form.tk_min-hint_')}</span>
          </div>

          {submitError && <p className="mt-3 text-[12px] text-destructive">{submitError}</p>}

          <div className="mt-4 flex items-center justify-end gap-2">
            <WaveButton type="submit" disabled={createRequest.isLoading} className="!h-9 !w-auto !text-[12px] px-4">
              {createRequest.isLoading ? tCommon('tk_loading_') : tAccount('reactivation.form.tk_submit_')}
            </WaveButton>
          </div>
        </form>
      )}
    </div>
  )
}
