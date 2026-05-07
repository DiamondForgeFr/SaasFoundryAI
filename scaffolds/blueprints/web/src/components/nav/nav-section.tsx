/**
 * Dependencies
 */
import { ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * Components
 */
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/shadcn/collapsible'
import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem } from '@/components/ui/shadcn/sidebar'

/**
 * TS Types
 */
import type { LucideIcon } from 'lucide-react'

export type NavSectionItem = {
  title: string
  url?: string
  icon?: LucideIcon
  isActive?: boolean
  subItems?: {
    title: string
    url: string
  }[]
}

interface NavSectionProps {
  section: {
    title: string
    items: NavSectionItem[]
  }
}

/**
 * React declaration
 */
export const NavSection = ({ section }: NavSectionProps) => {
  const { t: tNav } = useTranslation('nav')

  const renderSubItems = (item: NavSectionItem) => (
    <SidebarMenuSub>
      {item.subItems?.map((subItem) => (
        <SidebarMenuSubItem key={`${item.title}-${subItem.title}`}>
          <SidebarMenuSubButton asChild>
            <a href={subItem.url}>
              <span>{tNav(subItem.title)}</span>
            </a>
          </SidebarMenuSubButton>
        </SidebarMenuSubItem>
      ))}
    </SidebarMenuSub>
  )

  const renderCollapsibleItem = (item: NavSectionItem) => (
    <Collapsible key={item.title} asChild defaultOpen={false} className="group/collapsible">
      <SidebarMenuItem className="relative">
        <CollapsibleTrigger asChild>
          <SidebarMenuButton tooltip={tNav(item.title)}>
            {item.icon && <item.icon />}
            <span>{tNav(item.title)}</span>
            <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>{renderSubItems(item)}</CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  )

  const renderSimpleItem = (item: NavSectionItem) => (
    <SidebarMenuItem key={item.title} className="relative">
      <SidebarMenuButton asChild>
        <a href={item.url}>
          {item.icon && <item.icon />}
          <span>{tNav(item.title)}</span>
        </a>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )

  return (
    <SidebarGroup className="py-1">
      <SidebarGroupLabel className="text-muted-foreground/70 px-2.5 pt-1 pb-1 text-[10px] tracking-wider uppercase">{tNav(section.title)}</SidebarGroupLabel>
      <SidebarMenu>{section.items.map((item) => (item.subItems ? renderCollapsibleItem(item) : renderSimpleItem(item)))}</SidebarMenu>
    </SidebarGroup>
  )
}
