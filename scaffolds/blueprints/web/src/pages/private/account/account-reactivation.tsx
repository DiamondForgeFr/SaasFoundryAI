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
      <div className="container mx-auto max-w-xl py-12 text-center">
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
    <div data-testid="reactivation-page" className="container mx-auto max-w-2xl py-10">
      {/* Headline state card */}
      <div className="border-border bg-card mb-6 rounded-sm border p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-amber-500/15">
            <PowerOff className="h-6 w-6 text-amber-500" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-foreground text-lg font-bold tracking-tight">{tAccount('reactivation.tk_title_', { name: disabledAccount.name })}</h1>
            <p className="text-muted-foreground mt-1 text-[12px]">{tAccount('reactivation.tk_subtitle_')}</p>
          </div>
        </div>
      </div>

      {/* Informational banner when a platform-admin triggered the deactivation */}
      {isPlatformDeactivated && (
        <div className="border-border bg-muted/40 mb-6 rounded-sm border p-5">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
            <div>
              <div className="text-foreground text-[13px] font-semibold">{tAccount('reactivation.platform.tk_title_')}</div>
              <p className="text-muted-foreground mt-1 text-[12px]">{tAccount('reactivation.platform.tk_description_')}</p>
            </div>
          </div>
        </div>
      )}

      {/* Reactivation request flow — available regardless of deactivation scope */}
      {isLoadingLatest && <Skeleton className="h-32 w-full" />}

      {/* Pending request — show status + when submitted */}
      {!isLoadingLatest && hasPendingRequest && latest && (
        <div data-testid="reactivation-pending" className="rounded-sm border border-amber-500/40 bg-amber-500/5 p-5">
          <div className="flex items-start gap-3">
            <Clock className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-amber-500">{tAccount('reactivation.pending.tk_title_')}</div>
              <p className="text-muted-foreground mt-1 text-[12px]">{tAccount('reactivation.pending.tk_description_', { date: formatDateLong(latest.createdAt) })}</p>
              <div className="border-border bg-card mt-3 rounded-sm border p-3">
                <div className="text-muted-foreground mb-1 text-[10px] font-bold tracking-widest uppercase">{tAccount('reactivation.tk_your-message_')}</div>
                <p className="text-foreground text-[12px] whitespace-pre-wrap">{latest.message}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Rejected — show reason + allow resubmitting */}
      {!isLoadingLatest && wasRejected && latest && (
        <div data-testid="reactivation-rejected" className="border-destructive/40 bg-destructive/5 mb-6 rounded-sm border p-5">
          <div className="flex items-start gap-3">
            <AlertCircle className="text-destructive mt-0.5 h-4 w-4 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-destructive text-[13px] font-semibold">{tAccount('reactivation.rejected.tk_title_')}</div>
              <p className="text-muted-foreground mt-1 text-[12px]">{tAccount('reactivation.rejected.tk_description_', { date: latest.reviewedAt ? formatDateLong(latest.reviewedAt) : '—' })}</p>
              {latest.reviewNote && (
                <div className="border-border bg-card mt-3 rounded-sm border p-3">
                  <div className="text-muted-foreground mb-1 text-[10px] font-bold tracking-widest uppercase">{tAccount('reactivation.rejected.tk_review-note_')}</div>
                  <p className="text-foreground text-[12px] whitespace-pre-wrap">{latest.reviewNote}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Approved (rare — should redirect) — show success ribbon */}
      {!isLoadingLatest && latest?.status === 'APPROVED' && (
        <div className="mb-6 rounded-sm border border-emerald-500/40 bg-emerald-500/5 p-5">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-500" />
            <div>
              <div className="text-[13px] font-semibold text-emerald-500">{tAccount('reactivation.approved.tk_title_')}</div>
              <p className="text-muted-foreground mt-1 text-[12px]">{tAccount('reactivation.approved.tk_description_')}</p>
            </div>
          </div>
        </div>
      )}

      {/* Submission form — visible when no pending request */}
      {!isLoadingLatest && !hasPendingRequest && (
        <form
          data-testid="reactivation-request-form"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
          className="border-border bg-card rounded-sm border p-5"
        >
          <label htmlFor="reactivation-message" className="text-muted-foreground mb-2 block text-[11px] font-bold tracking-widest uppercase">
            {tAccount('reactivation.form.tk_label_')}
          </label>
          <p className="text-muted-foreground mb-3 text-[12px]">{tAccount('reactivation.form.tk_help_')}</p>
          <textarea
            data-testid="reactivation-message"
            id="reactivation-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={6}
            maxLength={2000}
            placeholder={tAccount('reactivation.form.tk_placeholder_')}
            className={cn(
              'border-border bg-background text-foreground w-full rounded-sm border p-3 text-[13px]',
              'placeholder:text-muted-foreground/60 focus:ring-primary/30 focus:border-primary/40 resize-y transition-colors focus:ring-2 focus:outline-none'
            )}
          />
          <div className="text-muted-foreground mt-1 flex items-center justify-between text-[11px]">
            <span className={cn(message.trim().length < 10 ? 'text-destructive' : 'text-muted-foreground')}>{tAccount('reactivation.form.tk_char-count_', { count: message.length })}</span>
            <span>{tAccount('reactivation.form.tk_min-hint_')}</span>
          </div>

          {submitError && <p className="text-destructive mt-3 text-[12px]">{submitError}</p>}

          <div className="mt-4 flex items-center justify-end gap-2">
            <WaveButton data-testid="reactivation-submit" type="submit" disabled={createRequest.isLoading} className="!h-9 !w-auto px-4 !text-[12px]">
              {createRequest.isLoading ? tCommon('tk_loading_') : tAccount('reactivation.form.tk_submit_')}
            </WaveButton>
          </div>
        </form>
      )}
    </div>
  )
}
