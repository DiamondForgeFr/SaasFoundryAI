/**
 * Public surface of `@ui-rework/ui-primitives`.
 *
 * Two import patterns are supported:
 *   - cherry-pick (recommended for tree-shaking):
 *     `import { Button } from '@ui-rework/ui-primitives/button'`
 *   - barrel (utilities, hooks, occasional bulk import):
 *     `import { cn, useIsMobile } from '@ui-rework/ui-primitives'`
 */

export { cn } from './lib/utils'
export { useIsMobile } from './hooks/use-is-mobile'

export * from './alert'
export * from './avatar'
export * from './badge'
export * from './breadcrumb'
export * from './button'
export * from './card'
export * from './checkbox'
export * from './collapsible'
export * from './command'
export * from './dialog'
export * from './dropdown-menu'
export * from './form'
export * from './input'
export * from './label'
export * from './pagination'
export * from './popover'
export * from './scroll-area'
export * from './select'
export * from './separator'
export * from './sheet'
export * from './sidebar'
export * from './skeleton'
export * from './switch'
export * from './table'
export * from './tabs'
export * from './textarea'
export * from './tooltip'
