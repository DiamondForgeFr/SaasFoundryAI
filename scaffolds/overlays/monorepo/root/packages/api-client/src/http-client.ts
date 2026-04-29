/**
 * Orval mutator — wraps the native Fetch API so that:
 *   - the same cookie-based auth (`credentials: 'include'`) used by the
 *     hand-written client keeps working with generated hooks;
 *   - the same 401 handling stays in one place;
 *   - generated calls go through `/api/...` (Vite proxy / Nginx) without
 *     leaking absolute URLs into the codegen output.
 *
 * Orval invokes `apiClientMutator<T>(config)` for every operation. The
 * `config` is what orval emits per endpoint: { url, method, params,
 * data, headers, signal }.
 */

export type BodyType<Data> = Data
export type ErrorType<Error> = Error

export interface ApiClientRequestConfig {
  url: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'
  params?: Record<string, unknown>
  data?: unknown
  headers?: Record<string, string>
  responseType?: string
  signal?: AbortSignal
}

/**
 * Hook for consumers that need to prepend a base URL (e.g. an absolute API
 * host for SSR or tests). Defaults to '' because OpenAPI paths emitted by
 * NestJS already include the global `/api` prefix.
 */
let resolveBaseUrl: () => string = () => ''

export function setApiBaseUrl(resolver: string | (() => string)): void {
  resolveBaseUrl = typeof resolver === 'function' ? resolver : () => resolver
}

/**
 * Hook for consumers to react to auth failures (e.g. invalidate `authMe`
 * query, redirect to /login). Called once per 401 response.
 */
let onUnauthorized: (() => void) | null = null

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler
}

function buildQueryString(params?: Record<string, unknown>): string {
  if (!params) return ''
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      for (const v of value) search.append(key, String(v))
    } else {
      search.append(key, String(value))
    }
  }
  const qs = search.toString()
  return qs ? `?${qs}` : ''
}

export const apiClientMutator = async <T>(config: ApiClientRequestConfig): Promise<T> => {
  const url = `${resolveBaseUrl()}${config.url}${buildQueryString(config.params)}`
  const isFormData = typeof FormData !== 'undefined' && config.data instanceof FormData

  const headers: Record<string, string> = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...config.headers
  }

  // For FormData, fetch must set Content-Type itself so the multipart boundary
  // is included. Orval emits 'Content-Type: multipart/form-data' (no boundary)
  // for upload endpoints — strip it so the browser fills it in correctly.
  if (isFormData) delete headers['Content-Type']

  const init: RequestInit = {
    method: config.method,
    headers,
    credentials: 'include',
    signal: config.signal
  }

  if (config.data !== undefined && config.method !== 'GET' && config.method !== 'HEAD') {
    init.body = isFormData ? (config.data as FormData) : JSON.stringify(config.data)
  }

  const response = await fetch(url, init)

  if (response.status === 401 && onUnauthorized) onUnauthorized()

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}))
    const error = new Error(
      typeof errorBody === 'object' && errorBody !== null && 'message' in errorBody
        ? String((errorBody as { message: unknown }).message)
        : `HTTP ${response.status}`
    ) as Error & { status: number; body: unknown }
    error.status = response.status
    error.body = errorBody
    throw error
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) return (await response.json()) as T
  return undefined as T
}

export default apiClientMutator
