import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { CodebaseScanner, CodebaseScannerContext, UiFlowFinding } from './types'

const ROUTE_PATH_RE = /\bpath:\s*['"`]([^'"`]+)['"`][^}]*?LazyRouteElement\((\w+)\)/gs
const PAGE_EXPORT_RE = /export\s+(?:default\s+)?(?:function|const)\s+(\w+)/
const DEFAULT_VALUES_RE = /defaultValues\s*:\s*\{([\s\S]*?)\}/
const DEFAULT_KEY_RE = /(\w+)\s*:/g
const NAME_ATTR_RE = /\bname=["'`](\w+)["'`]/g
const REGISTER_CALL_RE = /\bregister\(\s*["'`](\w+)["'`]/g
const ZOD_OBJECT_RE = /z\.object\(\s*\{([\s\S]*?)\}\s*\)/g

function normalizeRel(path: string): string {
  return path.split('\\').join('/')
}

export function extractRoutes(content: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const match of content.matchAll(ROUTE_PATH_RE)) {
    const [, pathValue, componentName] = match
    if (componentName && !map.has(componentName)) map.set(componentName, pathValue)
  }
  return map
}

export function extractFormFields(content: string): string[] {
  const fields = new Set<string>()

  const defaults = content.match(DEFAULT_VALUES_RE)
  if (defaults) {
    const body = defaults[1]
    for (const match of body.matchAll(DEFAULT_KEY_RE)) fields.add(match[1])
  }

  for (const match of content.matchAll(NAME_ATTR_RE)) fields.add(match[1])
  for (const match of content.matchAll(REGISTER_CALL_RE)) fields.add(match[1])

  for (const match of content.matchAll(ZOD_OBJECT_RE)) {
    const body = match[1]
    for (const keyMatch of body.matchAll(/(\w+)\s*:\s*z\./g)) fields.add(keyMatch[1])
  }

  return Array.from(fields).sort()
}

function extractPageArea(relFromWeb: string): string {
  const norm = normalizeRel(relFromWeb)
  const marker = 'src/pages/'
  const idx = norm.indexOf(marker)
  if (idx === -1) return 'unknown'
  const after = norm.slice(idx + marker.length)
  const segments = after.split('/').filter(Boolean)
  if (segments.length === 0) return 'unknown'
  if (segments.length === 1) return segments[0].replace(/\.tsx$/, '')
  return `${segments[0]}/${segments[1].replace(/\.tsx$/, '')}`
}

function extractPageComponentName(content: string): string | undefined {
  const match = content.match(PAGE_EXPORT_RE)
  return match ? match[1] : undefined
}

function guessLinkedEndpoint(route: string | undefined): string | undefined {
  if (!route) return undefined
  const cleaned = route.replace(/^\/+/, '').split('/')[0]
  if (!cleaned) return undefined
  return cleaned.toLowerCase()
}

export const reactScanner: CodebaseScanner = {
  id: 'react',
  describe: 'React pages/routes → ui-flow findings (regex-based)',
  async collect(context: CodebaseScannerContext): Promise<UiFlowFinding[]> {
    const webRoot = context.webRoot ?? context.scanRoot
    const webRootRel = normalizeRel(relative(context.scanRoot, webRoot))
    const webPrefix = webRootRel === '' ? '' : `${webRootRel}/`
    const pageFiles = context.files.filter((f) => {
      const norm = normalizeRel(f)
      return norm.startsWith(`${webPrefix}src/pages/`) && norm.endsWith('.tsx') && !norm.endsWith('.spec.tsx') && !norm.endsWith('.test.tsx')
    })
    const routeFiles = context.files.filter((f) => {
      const norm = normalizeRel(f)
      return norm.startsWith(`${webPrefix}src/router/`) && norm.endsWith('.tsx')
    })

    const routeMap = new Map<string, string>()
    for (const relFile of routeFiles) {
      try {
        const content = readFileSync(join(context.scanRoot, relFile), 'utf8')
        for (const [component, path] of extractRoutes(content)) {
          if (!routeMap.has(component)) routeMap.set(component, path)
        }
      } catch {
        // ignore unreadable route files
      }
    }

    const findings: UiFlowFinding[] = []
    for (const relFile of pageFiles) {
      const abs = join(context.scanRoot, relFile)
      let content: string
      try {
        content = readFileSync(abs, 'utf8')
      } catch {
        continue
      }

      const relFromWeb = webPrefix === '' ? relFile : relFile.slice(webPrefix.length)
      const area = extractPageArea(relFromWeb)
      const componentName = extractPageComponentName(content)
      const route = componentName ? routeMap.get(componentName) : undefined
      const formFields = extractFormFields(content)
      const linkedEndpointGuess = guessLinkedEndpoint(route)

      findings.push({
        kind: 'ui-flow',
        title: componentName ? `${componentName} (${area})` : `page (${area})`,
        area,
        file: relFile,
        route,
        formFields,
        linkedEndpointGuess
      })
    }

    return findings
  }
}
