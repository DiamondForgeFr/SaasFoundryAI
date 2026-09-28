import { readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

import { CodebaseScanner, CodebaseScannerContext, EndpointFinding } from './types'

const CONTROLLER_PREFIX_RE = /@Controller\s*\(\s*(?:\{[^}]*\bpath\s*:\s*)?['"`]([^'"`]+)['"`]/
const HTTP_DECORATOR_RE = /^\s*@(Get|Post|Put|Patch|Delete|All|Options|Head)\s*\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/
const METHOD_SIG_RE = /^\s*(?:public\s+|private\s+|protected\s+)?(?:async\s+|static\s+)*(\w+)\s*\(/

interface RawEndpoint {
  method: string
  subPath: string
  methodName: string
}

export function extractEndpoints(content: string): { prefix: string; endpoints: RawEndpoint[] } {
  const prefixMatch = content.match(CONTROLLER_PREFIX_RE)
  const prefix = prefixMatch ? prefixMatch[1] : ''

  const lines = content.split('\n')
  const endpoints: RawEndpoint[] = []
  let pending: { method: string; subPath: string } | null = null

  for (const line of lines) {
    const decoratorMatch = line.match(HTTP_DECORATOR_RE)
    if (decoratorMatch) {
      pending = { method: decoratorMatch[1].toUpperCase(), subPath: decoratorMatch[2] ?? '' }
      continue
    }
    if (!pending) continue
    if (line.trim().startsWith('@')) continue
    if (line.trim().startsWith('/**') || line.trim().startsWith('*') || line.trim().startsWith('//')) continue
    const sigMatch = line.match(METHOD_SIG_RE)
    if (!sigMatch) continue
    const methodName = sigMatch[1]
    if (methodName === 'constructor' || methodName === 'if' || methodName === 'for' || methodName === 'while') {
      pending = null
      continue
    }
    endpoints.push({ method: pending.method, subPath: pending.subPath, methodName })
    pending = null
  }

  return { prefix, endpoints }
}

function joinRoute(prefix: string, subPath: string): string {
  const cleanPrefix = prefix.replace(/^\/+|\/+$/g, '')
  const cleanSub = subPath.replace(/^\/+|\/+$/g, '')
  const head = cleanPrefix ? `/${cleanPrefix}` : ''
  const tail = cleanSub ? `/${cleanSub}` : ''
  return head + tail || '/'
}

function extractArea(relFromApi: string): string {
  const normalized = relFromApi.split('\\').join('/')
  const marker = 'src/modules/'
  const idx = normalized.indexOf(marker)
  if (idx === -1) return 'unknown'
  const after = normalized.slice(idx + marker.length)
  const segments = after.split('/')
  return segments[0] || 'unknown'
}

function moduleDir(relFromApi: string, area: string): string {
  const normalized = relFromApi.split('\\').join('/')
  const marker = `src/modules/${area}/`
  const idx = normalized.indexOf(marker)
  if (idx === -1) return dirname(normalized)
  return normalized.slice(0, idx + marker.length - 1)
}

function hasTestsForModule(allFiles: string[], moduleRelDir: string): boolean {
  const prefix = `${moduleRelDir.split('\\').join('/')}/`
  return allFiles.some((f) => {
    const norm = f.split('\\').join('/')
    return norm.startsWith(prefix) && /\.spec\.ts$/.test(norm)
  })
}

export const nestjsScanner: CodebaseScanner = {
  id: 'nestjs',
  describe: 'NestJS controllers → endpoint findings (regex-based)',
  async collect(context: CodebaseScannerContext): Promise<EndpointFinding[]> {
    const apiRoot = context.apiRoot ?? context.scanRoot
    const apiRootRel = relative(context.scanRoot, apiRoot).split('\\').join('/')
    const apiPrefix = apiRootRel === '' ? '' : `${apiRootRel}/`
    const controllers = context.files.filter((f) => {
      const norm = f.split('\\').join('/')
      return norm.startsWith(apiPrefix) && norm.endsWith('.controller.ts') && !norm.endsWith('.spec.ts')
    })

    const findings: EndpointFinding[] = []
    for (const relFile of controllers) {
      const abs = join(context.scanRoot, relFile)
      let content: string
      try {
        content = readFileSync(abs, 'utf8')
      } catch {
        continue
      }

      const relFromApi = apiPrefix === '' ? relFile : relFile.slice(apiPrefix.length)
      const area = extractArea(relFromApi)
      const modDir = moduleDir(relFromApi, area)
      const absoluteModuleDir = apiPrefix === '' ? modDir : `${apiPrefix}${modDir}`
      const hasTests = hasTestsForModule(context.files, absoluteModuleDir)

      const { prefix, endpoints } = extractEndpoints(content)
      for (const ep of endpoints) {
        const route = joinRoute(prefix, ep.subPath)
        findings.push({
          kind: 'endpoint',
          title: `${ep.method} ${route} — ${area}.${ep.methodName}`,
          area,
          file: relFile,
          method: ep.method,
          path: route,
          hasTests
        })
      }
    }

    return findings
  }
}
