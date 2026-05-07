/**
 * Resources
 */
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'

/**
 * Dependencies
 */
import { useModuleAccess } from '@/hooks/auth/useModuleAccess'
import { useBreadcrumb } from '@/hooks/ui/useBreadcrumb'

/**
 * Components
 */
import { AccountScopeHeader } from '@/components/ui/custom/account-scope-header'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/shadcn/tabs'
import { AccountEntities } from './account-entities'
import { AccountOverview } from './account-overview'
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
  const { hasPermission } = useModuleAccess()

  useEffect(() => {
    setBreadcrumb([
      { label: tAccount('tk_title_') },
      {
        label: tAccount(`tabs.tk_${currentTab}_`),
        description: tAccount(`tabs.tk_${currentTab}-description_`)
      }
    ])
  }, [currentTab, setBreadcrumb, tAccount])

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
          {hasPermission('ACCOUNT_ENTITY_MANAGEMENT') && (
            <TabsTrigger value="entities" className={tabTriggerClass}>
              {tAccount(`tabs.tk_entities_`)}
            </TabsTrigger>
          )}
          {hasPermission('ACCOUNT_USER_MANAGEMENT') && (
            <TabsTrigger value="users" className={tabTriggerClass}>
              {tAccount(`tabs.tk_users_`)}
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="overview">
          <AccountOverview />
        </TabsContent>

        {hasPermission('ACCOUNT_USER_MANAGEMENT') && (
          <TabsContent value="users">
            <AccountUsers />
          </TabsContent>
        )}

        {hasPermission('ACCOUNT_ENTITY_MANAGEMENT') && (
          <TabsContent value="entities">
            <AccountEntities />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
