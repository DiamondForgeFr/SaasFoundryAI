import i18next from 'i18next'
import { Building2, Check, ChevronDown, Copy, Shield, User } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { useAdminScope } from '@/hooks/auth/useAdminScope'
import { useAccount } from '@/hooks/api/accounts'
import { cn } from '@/utils/ui'

function formatDate(d: string | Date | null | undefined) {
  if (!d) return '—'
  const date = new Date(d)
  return date.toLocaleDateString(i18next.language || 'en', { month: 'short', day: 'numeric', year: 'numeric' })
}

function shortenId(id: string) {
  if (id.length <= 14) return id
  return `${id.slice(0, 8)}…${id.slice(-4)}`
}

export function AccountScopeHeader() {
  const { isAccountAdmin, isEntityAdmin, activeAccount, allAccounts, isMultiAccount, managedEntities } = useAdminScope()
  const queryClient = useQueryClient()
  const accountId = activeAccount?.id
  const { data: account } = useAccount(accountId as string)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const { t: tAccount } = useTranslation('account')

  const handleCopy = async () => {
    if (!accountId) return
    await navigator.clipboard.writeText(accountId)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="mb-5 flex items-start justify-between gap-4 rounded-sm border border-border bg-card px-4 py-3">
      {/* Left — scope identity + meta row */}
      <div className="flex items-start gap-3 min-w-0">
        {isAccountAdmin ? (
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary/15">
            <Shield className="h-4 w-4 text-primary" />
          </div>
        ) : (
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-muted">
            <User className="h-4 w-4 text-muted-foreground" />
          </div>
        )}

        <div className="min-w-0 flex flex-col gap-1.5">
          {/* Title row */}
          <div className="flex items-center gap-2 flex-wrap">
            {isAccountAdmin ? (
              <span className="font-display font-bold text-foreground truncate text-sm">{activeAccount?.name ?? tAccount('scopeHeader.tk_account-fallback_')}</span>
            ) : (
              <span className="font-display font-bold text-foreground text-sm">{managedEntities.map((e) => e.name).join(' · ') || tAccount('scopeHeader.tk_my-entities-fallback_')}</span>
            )}
            <span
              className={cn(
                'flex-shrink-0 rounded-[2px] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                isAccountAdmin ? 'bg-primary/15 text-primary border border-primary/25' : 'bg-muted text-muted-foreground border border-border'
              )}
            >
              {isAccountAdmin ? tAccount('scopeHeader.tk_role-account-admin_') : tAccount('scopeHeader.tk_role-entity-admin_')}
            </span>
            {account?.isActive !== false && (
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-500">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px] shadow-emerald-500" />
                {tAccount('scopeHeader.tk_status-active_')}
              </span>
            )}
          </div>

          {/* Meta row — ID, Created, Updated */}
          {isAccountAdmin && accountId && (
            <div className="flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider">{tAccount('scopeHeader.tk_id_')}</span>
                <span className="inline-flex items-center gap-1.5 rounded-[2px] border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                  {shortenId(accountId)}
                  <button type="button" onClick={handleCopy} className="cursor-pointer text-muted-foreground hover:text-foreground transition-colors" title={tAccount('scopeHeader.tk_copy-id_')}>
                    {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                  </button>
                </span>
              </span>
              {account?.createdAt && (
                <>
                  <span className="text-border">·</span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider">{tAccount('scopeHeader.tk_created_')}</span>
                    <span className="text-foreground font-medium">{formatDate(account.createdAt)}</span>
                  </span>
                </>
              )}
              {account?.updatedAt && (
                <>
                  <span className="text-border">·</span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider">{tAccount('scopeHeader.tk_updated_')}</span>
                    <span className="text-foreground font-medium">{formatDate(account.updatedAt)}</span>
                  </span>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right — switcher + new account */}
      <div className="flex flex-shrink-0 items-center gap-2">
        {isAccountAdmin && isMultiAccount && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setSwitcherOpen((v) => !v)}
              className="cursor-pointer flex items-center gap-1.5 rounded-[2px] border border-border bg-background px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <Building2 className="h-3.5 w-3.5" />
              {tAccount('scopeHeader.tk_switch-account_')}
              <ChevronDown className="h-3 w-3" />
            </button>

            {switcherOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setSwitcherOpen(false)} />
                <div className="absolute right-0 top-full z-20 mt-1 min-w-[220px] rounded-[2px] border border-border bg-card shadow-lg">
                  <div className="p-1">
                    <p className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{tAccount('scopeHeader.tk_your-accounts_')}</p>
                    {allAccounts.map((acc) => (
                      <button
                        key={acc.id}
                        type="button"
                        onClick={() => {
                          setSwitcherOpen(false)
                          if (!acc.isActive) queryClient.invalidateQueries()
                        }}
                        className={cn(
                          'cursor-pointer flex w-full items-center justify-between rounded-[2px] px-2 py-2 text-left text-xs transition-colors hover:bg-secondary',
                          acc.isActive && 'bg-primary/8 border border-primary/20'
                        )}
                      >
                        <div>
                          <div className="font-semibold text-foreground">{acc.name}</div>
                          <div className="text-[10px] text-muted-foreground">{tAccount('scopeHeader.tk_role-account-admin_')}</div>
                        </div>
                        {acc.isActive && <Shield className="h-3 w-3 text-primary" />}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {isEntityAdmin && managedEntities.length > 1 && (
          <button
            type="button"
            className="cursor-pointer flex items-center gap-1.5 rounded-[2px] border border-border bg-background px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            {tAccount('scopeHeader.tk_switch-entity_')}
            <ChevronDown className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  )
}
