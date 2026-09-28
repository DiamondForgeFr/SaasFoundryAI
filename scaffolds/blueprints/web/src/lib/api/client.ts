/**
 * Resources
 */
import { queryClient } from '@/lib/react-query/query-client'

const ACCOUNT_DISABLED_MESSAGE = 'This account is disabled'

const isSessionInvalidatingUnauthorized = (status: number, body: unknown): boolean => {
  if (status !== 401) return false
  if (typeof body !== 'object' || body === null || !('message' in body)) return true
  return (body as { message?: unknown }).message !== ACCOUNT_DISABLED_MESSAGE
}

/**
 * API Client using native Fetch API
 */
const apiClient = {
  /**
   * Generic method for making HTTP requests
   */
  async request<T>(
    endpoint: string,
    method: string = 'GET',
    data?: unknown,
    options: {
      headers?: Record<string, string>
      params?: Record<string, string | number | boolean | string[] | number[]>
    } = {}
  ): Promise<T> {
    const baseApiUrl = '/api'
    let url = `${baseApiUrl}${endpoint}`

    // Add query parameters if they exist
    if (options.params) {
      const searchParams = new URLSearchParams()
      Object.entries(options.params).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          value.forEach((v) => searchParams.append(key, String(v)))
        } else if (value !== undefined) {
          searchParams.append(key, String(value))
        }
      })
      const queryString = searchParams.toString()
      if (queryString) {
        url += `?${queryString}`
      }
    }

    // Default headers
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers
    }

    // Request options
    const requestOptions: RequestInit = {
      method,
      headers,
      // Important: include cookies in each request
      credentials: 'include'
    }

    // Add request body for non-GET methods
    if (data && method !== 'GET') requestOptions.body = JSON.stringify(data)

    try {
      const response = await fetch(url, requestOptions)

      // HTTP error handling
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))

        // A disabled account is still an authenticated session: keep authMe so the route guard
        // can send the user to the reactivation flow. Other 401s still invalidate the session.
        if (isSessionInvalidatingUnauthorized(response.status, errorData)) {
          // Invalidate authentication status
          queryClient.setQueryData(['authMe'], null)
          localStorage.removeItem('authMe')
        }

        // Get error message from API if available. Expose `status`/`body` on the thrown error
        // (same shape as the monorepo api-client mutator) so callers like persistAuthMe can
        // distinguish session-invalidating statuses (401/403/404) from transient failures.
        const error = new Error(errorData.message || `HTTP Error ${response.status}`) as Error & { status: number; body: unknown }
        error.status = response.status
        error.body = errorData
        throw error
      }

      // Check if response is empty
      const contentType = response.headers.get('content-type')
      if (contentType && contentType.includes('application/json')) return (await response.json()) as T

      return {} as T
    } catch (error) {
      console.error('API Error:', error)
      throw error
    }
  },

  /**
   * Specific HTTP methods
   */
  get<T>(endpoint: string, params?: Record<string, string | number | boolean | string[] | number[]>, customHeaders = {}): Promise<T> {
    return this.request<T>(endpoint, 'GET', undefined, { headers: customHeaders, params })
  },

  post<T>(endpoint: string, data: unknown, customHeaders = {}): Promise<T> {
    return this.request<T>(endpoint, 'POST', data, { headers: customHeaders })
  },

  put<T>(endpoint: string, data: unknown, customHeaders = {}): Promise<T> {
    return this.request<T>(endpoint, 'PUT', data, { headers: customHeaders })
  },

  patch<T>(endpoint: string, data: unknown, customHeaders = {}): Promise<T> {
    return this.request<T>(endpoint, 'PATCH', data, { headers: customHeaders })
  },

  delete<T>(endpoint: string, customHeaders = {}): Promise<T> {
    return this.request<T>(endpoint, 'DELETE', undefined, { headers: customHeaders })
  },

  async upload<T>(endpoint: string, file: File, fieldName = 'file'): Promise<T> {
    const baseApiUrl = '/api'
    const url = `${baseApiUrl}${endpoint}`
    const formData = new FormData()
    formData.append(fieldName, file)

    try {
      const response = await fetch(url, {
        method: 'POST',
        body: formData,
        credentials: 'include'
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        if (isSessionInvalidatingUnauthorized(response.status, errorData)) {
          queryClient.setQueryData(['authMe'], null)
          localStorage.removeItem('authMe')
        }
        const error = new Error(errorData.message || `HTTP Error ${response.status}`) as Error & { status: number; body: unknown }
        error.status = response.status
        error.body = errorData
        throw error
      }

      const contentType = response.headers.get('content-type')
      if (contentType && contentType.includes('application/json')) return (await response.json()) as T
      return {} as T
    } catch (error) {
      console.error('API Upload Error:', error)
      throw error
    }
  }
}

export default apiClient
