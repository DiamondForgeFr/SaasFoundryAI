/**
 * Resources
 */
import { Fragment, useEffect } from 'react'
import i18n from 'i18next'
import { Outlet } from 'react-router-dom'

/**
 * Dependencies
 */
import { BreadcrumbProvider } from '@/components/ui/custom/breadcrumb-context'
import { useMe } from '@/hooks/api/auth/queries/useMe'
import { useBreadcrumb } from '@/hooks/ui/useBreadcrumb'

/**
 * Components
 */
import { LayoutSidebar } from '@/components/layout/layout-sidebar'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/shadcn/breadcrumb'
import { Separator } from '@/components/ui/shadcn/separator'
import { SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from '@/components/ui/shadcn/sidebar'

/**
 * Brand wordmark shown in the top bar only while the sidebar is collapsed — the sidebar header
 * already carries it when expanded, so this keeps "SaaSFoundry" visible right next to the toggle.
 */
const HeaderBrand = () => {
  const { state } = useSidebar()
  if (state !== 'collapsed') return null
  return (
    <>
      <span className="font-display text-sm font-bold tracking-tight text-foreground select-none">
        SaaSFoundry<span className="text-primary">AI</span>
      </span>
      <Separator orientation="vertical" className="mr-2 h-4" />
    </>
  )
}

/**
 * React declaration
 */
const LayoutLoggedContent = () => {
  const { items } = useBreadcrumb()
  const { data: me } = useMe()

  useEffect(() => {
    if (!me?.preferences?.locale) return
    const desired = me.preferences.locale.toLowerCase()
    const current = (i18n.language || '').toLowerCase().split('-')[0]
    if (current !== desired) i18n.changeLanguage(desired)
  }, [me?.preferences?.locale])

  const renderBreadcrumbItems = () => (
    <BreadcrumbList>
      {items.map((item, index) => (
        <Fragment key={index}>
          {index > 0 && <BreadcrumbSeparator />}
          <BreadcrumbItem>{index === items.length - 1 ? <BreadcrumbPage>{item.label}</BreadcrumbPage> : <BreadcrumbLink href="#">{item.label}</BreadcrumbLink>}</BreadcrumbItem>
        </Fragment>
      ))}
    </BreadcrumbList>
  )

  const renderHeader = () => (
    <header className="flex h-16 shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
      <div className="flex items-center gap-2 px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 h-4" />
        <HeaderBrand />
        <Breadcrumb>{renderBreadcrumbItems()}</Breadcrumb>
      </div>
      {items.length > 0 && items[items.length - 1].description && (
        <div data-testid="page-description" className="ml-4 text-sm text-muted-foreground">
          {items[items.length - 1].description}
        </div>
      )}
    </header>
  )

  return (
    <SidebarProvider defaultOpen={false} style={{ '--sidebar-width': '14rem' } as React.CSSProperties}>
      <LayoutSidebar />
      <SidebarInset>
        {renderHeader()}
        <div className="flex flex-1 flex-col gap-4 p-4">
          <main>
            <Outlet />
          </main>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

export const LayoutLogged = () => (
  <BreadcrumbProvider>
    <LayoutLoggedContent />
  </BreadcrumbProvider>
)
