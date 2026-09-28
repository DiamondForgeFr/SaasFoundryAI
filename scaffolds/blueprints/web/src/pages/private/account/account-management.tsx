/**
 * Resources
 */
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'

/**
 * Dependencies
 */
import { useAdminScope } from '@/hooks/auth/useAdminScope'
import { useModuleAccess } from '@/hooks/auth/useModuleAccess'
import { useBreadcrumb } from '@/hooks/ui/useBreadcrumb'

/**
 * Components
 */
import { AccountScopeHeader } from '@/components/ui/custom/account-scope-header'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/shadcn/tabs'
import { AccountAccounts } from './account-accounts'
import { AccountEntities } from './account-entities'
import { AccountOverview } from './account-overview'
import { AccountPlatformUsers } from './account-platform-users'
import { AccountRoles } from './account-roles'
import { AccountUsers } from './account-users'

/**
 * React declaration
 */
export function AccountManagement() {
  const { t: tAccount } = useTranslation('account')
  const [searchParams] = useSearchParams()
  const { setBreadcrumb } = useBreadcrumb()
  const navigate = useNavigate()
  const currentTab = searchParams.get('tab') || 'overview'
  const { hasSubModule } = useModuleAccess()
  const { currentScope, isPlatformAdmin } = useAdminScope()
  // PLATFORM_ALL = the platform-admin browsing the multi-account view, no specific account scoped.
  // Entities/Users tabs only make sense once an account is selected — hide them in PLATFORM_ALL.
  const isPlatformAll = isPlatformAdmin && currentScope.kind === 'PLATFORM' && !currentScope.id

  useEffect(() => {
    setBreadcrumb([
      { label: tAccount('tk_title_') },
      {
        label: tAccount(`tabs.tk_${currentTab}_`),
        description: tAccount(`tabs.tk_${currentTab}-description_`)
      }
    ])
  }, [currentTab, setBreadcrumb, tAccount])

  // Tab availability matrix:
  //   PLATFORM_ALL  : overview · accounts · roles · users     (no entities — accounts have entities)
  //   account scope : overview · entities · roles · users     (no accounts — that's a platform view)
  //
  // Whenever the scope changes we may land on a tab that no longer exists for the new scope —
  // redirect during render via <Navigate> so React doesn't paint the broken state first.
  const invalidTabRedirect = (isPlatformAll && currentTab === 'entities') || (!isPlatformAll && currentTab === 'accounts')
  if (invalidTabRedirect) return <Navigate to="/account?tab=overview" replace />

  const handleTabChange = (value: string) => {
    navigate(`/account?tab=${value}`, { replace: true })
  }

  const tabTriggerClass = `
      relative bg-transparent border-none rounded-none shadow-none
      px-4 py-3 text-xs font-bold uppercase tracking-wider
      text-muted-foreground transition-colors duration-150
      hover:text-foreground
      data-[state=active]:text-foreground data-[state=active]:shadow-none
      data-[state=active]:bg-transparent
      after:content-[''] after:absolute after:left-0 after:right-0 after:bottom-0 after:h-[2px]
      after:bg-transparent data-[state=active]:after:bg-primary
    `

  return (
    <div className="container mx-auto">
      <AccountScopeHeader />
      <Tabs value={currentTab} onValueChange={handleTabChange} className="space-y-5">
        <TabsList className="flex w-full justify-start gap-0 rounded-none bg-transparent border-b border-border p-0 h-auto">
          <TabsTrigger value="overview" className={tabTriggerClass}>
            {tAccount(`tabs.tk_overview_`)}
          </TabsTrigger>
          {/* Accounts tab — PLATFORM_ALL only, gated by the PLATFORM_ACCOUNTS sub-module (replaces ACCOUNT_LIST_ALL read meaning) */}
          {isPlatformAll && hasSubModule('PLATFORM_ACCOUNTS') && (
            <TabsTrigger value="accounts" className={tabTriggerClass}>
              {tAccount(`tabs.tk_accounts_`)}
            </TabsTrigger>
          )}
          {!isPlatformAll && hasSubModule('ENTITIES') && (
            <TabsTrigger value="entities" className={tabTriggerClass}>
              {tAccount(`tabs.tk_entities_`)}
            </TabsTrigger>
          )}
          {hasSubModule('ROLES') && (
            <TabsTrigger value="roles" className={tabTriggerClass}>
              {tAccount(`tabs.tk_roles_`)}
            </TabsTrigger>
          )}
          {(isPlatformAll ? hasSubModule('PLATFORM_USERS') : hasSubModule('USERS')) && (
            <TabsTrigger value="users" className={tabTriggerClass}>
              {tAccount(`tabs.tk_users_`)}
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="overview">
          <AccountOverview />
        </TabsContent>

        {isPlatformAll && hasSubModule('PLATFORM_ACCOUNTS') && (
          <TabsContent value="accounts">
            <AccountAccounts />
          </TabsContent>
        )}

        {!isPlatformAll && hasSubModule('ENTITIES') && (
          <TabsContent value="entities">
            <AccountEntities />
          </TabsContent>
        )}

        {hasSubModule('ROLES') && (
          <TabsContent value="roles">
            <AccountRoles />
          </TabsContent>
        )}

        {isPlatformAll && hasSubModule('PLATFORM_USERS') && (
          <TabsContent value="users">
            <AccountPlatformUsers />
          </TabsContent>
        )}

        {!isPlatformAll && hasSubModule('USERS') && (
          <TabsContent value="users">
            <AccountUsers />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
