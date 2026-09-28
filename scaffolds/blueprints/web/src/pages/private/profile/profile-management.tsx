/**
 * Resources
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Building2, Calendar, Check, Copy, Globe, Mail, Moon, Shield, Sun, User as UserIcon, Users } from 'lucide-react'

/**
 * Dependencies
 */
import { useTheme } from '@/components/theme/theme-provider'
import { useMe } from '@/hooks/api/auth/queries/useMe'
import { useUpdateMyPreferences } from '@/hooks/api/users/mutations/useUpdateMyPreferences'
import { useBreadcrumb } from '@/hooks/ui/useBreadcrumb'
import { formatDateLong, getInitials } from '@/utils/format'

/**
 * Components
 */
import { SegmentedFilter } from '@/components/ui/custom/segmented-filter'
import { Skeleton } from '@/components/ui/shadcn/skeleton'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/shadcn/tooltip'

/* ─────────────── HEADER ─────────────── */

function ProfileHeader({ fullName, email, initials, roleLabel }: { fullName: string; email: string; initials: string; roleLabel: string }) {
  return (
    <div data-testid="profile-header" className="flex items-center gap-4 rounded-sm border border-border bg-card px-4 py-3.5 mb-6">
      <div className="flex h-12 w-12 items-center justify-center rounded-sm bg-primary/22 text-primary text-base font-bold">{initials}</div>
      <div className="flex-1 min-w-0">
        <div className="font-display text-lg font-bold text-foreground leading-tight truncate">{fullName}</div>
        <div className="text-[12px] text-muted-foreground leading-tight truncate">{email}</div>
      </div>
      {roleLabel && (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-widest border border-primary/22 bg-primary/12 text-primary whitespace-nowrap">
          <Shield className="h-3 w-3" />
          {roleLabel}
        </span>
      )}
    </div>
  )
}

/* ─────────────── SECTION ─────────────── */

function Section({ icon, title, meta, children, dataTestid }: { icon: React.ReactNode; title: string; meta?: string; children: React.ReactNode; dataTestid?: string }) {
  return (
    <div data-testid={dataTestid} className="rounded-sm border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-primary">{icon}</span>
          <span className="font-display text-[13px] font-bold text-foreground">{title}</span>
          {meta && <span className="text-[11px] text-muted-foreground font-medium">{meta}</span>}
        </div>
      </div>
      {children}
    </div>
  )
}

/* ─────────────── ACCOUNT CHIP (with copy-to-clipboard tooltip) ─────────────── */

function AccountChip({
  id,
  name,
  isActive,
  indirect,
  copyLabel,
  copiedLabel,
  indirectLabel
}: {
  id: string
  name: string
  isActive: boolean
  indirect: boolean
  copyLabel: string
  copiedLabel: string
  indirectLabel: string
}) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(id)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable — silently ignore */
    }
  }

  return (
    <Tooltip open={copied ? true : undefined}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={handleCopy}
          className={`group inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm text-[11px] border bg-muted text-foreground/80 transition-colors hover:border-primary/60 hover:bg-primary/8 ${indirect ? 'border-dashed border-border/70' : 'border-border'}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-muted-foreground/50'}`} />
          <span>{name}</span>
          {indirect && (
            <span className="ml-0.5 inline-flex items-center px-1 py-px rounded-[3px] text-[9px] font-bold uppercase tracking-wider border border-border/70 text-muted-foreground">
              {indirectLabel}
            </span>
          )}
          {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3 text-muted-foreground/60 opacity-0 transition-opacity group-hover:opacity-100" />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="font-mono text-[10px]">
        {copied ? copiedLabel : `${copyLabel} · ${id}`}
      </TooltipContent>
    </Tooltip>
  )
}

/* ─────────────── INFO ROW ─────────────── */

function InfoRow({ label, value, icon }: { label: string; value: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[180px_1fr] items-center gap-4 px-4 py-3 border-b border-border last:border-b-0">
      <span className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="text-[13px] text-foreground">{value}</span>
    </div>
  )
}

/* ─────────────── MAIN ─────────────── */

export function ProfileManagement() {
  const { setBreadcrumb } = useBreadcrumb()
  const { data: user, isLoading } = useMe()
  const { theme, setTheme } = useTheme()
  const { i18n, t: tProfile } = useTranslation('profile')
  const { t: tAccount } = useTranslation('account')
  const { submit: updatePreferences, isLoading: isUpdatingPrefs } = useUpdateMyPreferences()

  // Resolve a role name to its built-in i18n label (falls back to the raw name for custom roles).
  const knownRoles = ['guest', 'account-user', 'account-admin', 'entity-admin', 'entity-user', 'platform-admin', 'platform-user']
  const roleDisplay = (name: string) => {
    const key = name.toLowerCase()
    return knownRoles.includes(key) ? tAccount(`roles.builtin.tk_${key.replace('-', '_')}_`) : name.replace(/_/g, ' ').toLowerCase()
  }

  useEffect(() => {
    setBreadcrumb([{ label: tProfile('tk_title_') }, { label: tProfile('tk_breadcrumb-settings_'), description: tProfile('tk_breadcrumb-description_') }])
  }, [setBreadcrumb, tProfile])

  if (isLoading || !user) {
    return (
      <div className="container mx-auto space-y-4 opacity-25">
        <Skeleton className="skeleton-shimmer-orange h-20 w-full rounded-sm" />
        <Skeleton className="skeleton-shimmer-orange h-72 w-full rounded-sm" />
        <Skeleton className="skeleton-shimmer-orange h-40 w-full rounded-sm" />
      </div>
    )
  }

  const fullName = `${user.people?.firstname ?? ''} ${user.people?.lastname ?? ''}`.trim() || user.email
  const initials = getInitials(user.people?.firstname ?? user.email[0], user.people?.lastname ?? '')
  const primaryRole = user.roles.find((r) => r.toLowerCase() !== 'guest') ?? user.roles[0]
  const roleLabel = primaryRole ? roleDisplay(primaryRole) : ''

  // Platform-only users have no account/entity link; hide the memberships block entirely.
  const isPlatformOnly = user.roleAssignments.length > 0 && user.roleAssignments.every((r) => r.scope === 'PLATFORM')

  // Merge direct accounts + accounts inferred from entities (parent of an entity the user is linked to).
  // A directly linked account always wins (its chip won't be flagged "indirect" even if it also appears via an entity).
  const directAccountIds = new Set(user.accounts.map((a) => a.id))
  const indirectAccountsMap = new Map<string, { id: string; name: string; isActive: boolean }>()
  for (const entity of user.entities) {
    if (entity.account && !directAccountIds.has(entity.account.id) && !indirectAccountsMap.has(entity.account.id)) {
      indirectAccountsMap.set(entity.account.id, entity.account)
    }
  }
  const directAccounts = user.accounts.map((a) => ({ id: a.id, name: a.name, isActive: a.isActive, indirect: false }))
  const indirectAccounts = Array.from(indirectAccountsMap.values()).map((a) => ({ ...a, indirect: true }))
  const displayedAccounts = [...directAccounts, ...indirectAccounts]
  const accountsCount = displayedAccounts.length
  const entitiesCount = user.entities.length

  const currentLang = (user.preferences?.locale ?? 'EN').toLowerCase() as 'en' | 'fr'

  const handleLanguageChange = (v: 'en' | 'fr') => {
    const apiLocale = v.toUpperCase() as 'EN' | 'FR'
    i18n.changeLanguage(v)
    updatePreferences({ locale: apiLocale })
  }

  return (
    <div className="container mx-auto">
      <ProfileHeader fullName={fullName} email={user.email} initials={initials} roleLabel={roleLabel} />

      <div className="flex flex-col gap-4">
        <Section
          dataTestid="profile-info-section"
          icon={<UserIcon className="h-3.5 w-3.5" />}
          title={tProfile('sections.profileInfo.tk_title_')}
          meta={tProfile('sections.profileInfo.tk_meta-readonly_')}
        >
          <InfoRow
            icon={<UserIcon className="h-3 w-3 text-primary" />}
            label={tProfile('sections.profileInfo.tk_first-name_')}
            value={user.people?.firstname || <span className="text-muted-foreground">—</span>}
          />
          <InfoRow
            icon={<UserIcon className="h-3 w-3 text-primary" />}
            label={tProfile('sections.profileInfo.tk_last-name_')}
            value={user.people?.lastname || <span className="text-muted-foreground">—</span>}
          />
          <InfoRow icon={<Mail className="h-3 w-3 text-primary" />} label={tProfile('sections.profileInfo.tk_email_')} value={user.email} />
          <InfoRow
            icon={<Shield className="h-3 w-3 text-primary" />}
            label={tProfile('sections.profileInfo.tk_roles_')}
            value={
              user.roles.length === 0 ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <span className="flex flex-wrap gap-1">
                  {user.roles.map((r) => (
                    <span
                      key={r}
                      className="inline-flex items-center px-2 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider border border-border bg-secondary text-foreground/80 whitespace-nowrap"
                    >
                      {roleDisplay(r)}
                    </span>
                  ))}
                </span>
              )
            }
          />
          <InfoRow icon={<Calendar className="h-3 w-3 text-primary" />} label={tProfile('sections.profileInfo.tk_member-since_')} value={formatDateLong(user.createdAt)} />
        </Section>

        {!isPlatformOnly && (
          <TooltipProvider delayDuration={150}>
            <Section
              dataTestid="memberships-section"
              icon={<Building2 className="h-3.5 w-3.5" />}
              title={tProfile('sections.memberships.tk_title_')}
              meta={tProfile(accountsCount > 1 || entitiesCount > 1 ? 'sections.memberships.tk_meta-many_' : 'sections.memberships.tk_meta-one_', { accounts: accountsCount, entities: entitiesCount })}
            >
              <InfoRow
                icon={<Users className="h-3 w-3 text-primary" />}
                label={tProfile('sections.memberships.tk_accounts_')}
                value={
                  displayedAccounts.length === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <span className="flex flex-wrap gap-1.5">
                      {displayedAccounts.map((a) => (
                        <AccountChip
                          key={a.id}
                          id={a.id}
                          name={a.name}
                          isActive={a.isActive}
                          indirect={a.indirect}
                          copyLabel={tProfile('sections.memberships.tk_account-copy_')}
                          copiedLabel={tProfile('sections.memberships.tk_account-copied_')}
                          indirectLabel={tProfile('sections.memberships.tk_account-indirect_')}
                        />
                      ))}
                    </span>
                  )
                }
              />
              <InfoRow
                icon={<Building2 className="h-3 w-3 text-primary" />}
                label={tProfile('sections.memberships.tk_entities_')}
                value={
                  user.entities.length === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <span className="flex flex-wrap gap-1.5">
                      {user.entities.map((e) => (
                        <span key={e.id} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm text-[11px] border border-border bg-muted text-foreground/80">
                          <span className={`h-1.5 w-1.5 rounded-full ${e.isActive ? 'bg-emerald-500' : 'bg-muted-foreground/50'}`} />
                          {e.organization?.name ? `${e.organization.name} · ${e.name}` : e.name}
                        </span>
                      ))}
                    </span>
                  )
                }
              />
            </Section>
          </TooltipProvider>
        )}

        <Section dataTestid="preferences-section" icon={<Sun className="h-3.5 w-3.5" />} title={tProfile('sections.preferences.tk_title_')} meta={tProfile('sections.preferences.tk_meta_')}>
          <InfoRow
            icon={<Moon className="h-3 w-3 text-primary" />}
            label={tProfile('sections.preferences.tk_theme_')}
            value={
              <SegmentedFilter
                dataTestid="theme-switch"
                value={theme}
                onChange={setTheme}
                options={[
                  { value: 'light', label: tProfile('sections.preferences.tk_theme-light_'), icon: <Sun className="h-3 w-3" /> },
                  { value: 'dark', label: tProfile('sections.preferences.tk_theme-dark_'), icon: <Moon className="h-3 w-3" /> },
                  { value: 'system', label: tProfile('sections.preferences.tk_theme-system_') }
                ]}
              />
            }
          />
          <InfoRow
            icon={<Globe className="h-3 w-3 text-primary" />}
            label={tProfile('sections.preferences.tk_language_')}
            value={
              <div className="inline-flex items-center gap-2">
                <SegmentedFilter
                  dataTestid="language-switch"
                  value={currentLang}
                  onChange={handleLanguageChange}
                  options={[
                    { value: 'en', label: tProfile('sections.preferences.tk_language-en_') },
                    { value: 'fr', label: tProfile('sections.preferences.tk_language-fr_') }
                  ]}
                />
                {isUpdatingPrefs && <span className="text-[10px] text-muted-foreground uppercase tracking-widest">{tProfile('sections.preferences.tk_saving_')}</span>}
              </div>
            }
          />
        </Section>
      </div>
    </div>
  )
}
