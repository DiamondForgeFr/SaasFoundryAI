/**
 * Public surface of `@{{PROJECT_NAME}}/ui-primitives`.
 *
 * Consumers can either:
 *   - cherry-pick a primitive via the `./<name>` subpath (recommended for tree-shaking)
 *     `import { Button } from '@{{PROJECT_NAME}}/ui-primitives/button'`
 *   - or import from the barrel below for utilities / hooks.
 */

export { cn } from './lib/utils'
export { useIsMobile } from './hooks/use-is-mobile'
