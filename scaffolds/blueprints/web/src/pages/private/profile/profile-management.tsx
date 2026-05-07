/**
 * Resources
 */
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Building2, Calendar, Globe, Mail, Moon, Shield, Sun, User as UserIcon, Users } from 'lucide-react'

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
  const { submit: updatePreferences, isLoading: isUpdatingPrefs } = useUpdateMyPreferences()

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
  const roleLabel = primaryRole ? primaryRole.replace(/_/g, ' ').toLowerCase() : ''
  const accountsCount = user.accounts.length
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
                      {r.replace(/_/g, ' ').toLowerCase()}
                    </span>
                  ))}
                </span>
              )
            }
          />
          <InfoRow icon={<Calendar className="h-3 w-3 text-primary" />} label={tProfile('sections.profileInfo.tk_member-since_')} value={formatDateLong(user.createdAt)} />
        </Section>

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
              user.accounts.length === 0 ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <span className="flex flex-wrap gap-1.5">
                  {user.accounts.map((a) => (
                    <span key={a.id} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm text-[11px] border border-border bg-muted text-foreground/80">
                      <span className={`h-1.5 w-1.5 rounded-full ${a.isActive ? 'bg-emerald-500' : 'bg-muted-foreground/50'}`} />
                      {a.name}
                    </span>
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
