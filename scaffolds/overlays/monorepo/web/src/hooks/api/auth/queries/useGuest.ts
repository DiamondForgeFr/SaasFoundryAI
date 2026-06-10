/**
 * Resources
 */
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'

/**
 * Dependencies
 */
import { authControllerGetGuest } from '@{{PROJECT_NAME}}/api-client/generated/api/authentication/authentication'

/**
 * Schemas & DTOs
 */
export const useGuestSchema = () => {
  const response = z.object({
    roles: z.array(z.string()),
    modules: z.array(z.string()),
    permissions: z.array(z.string()),
    awaitsPlatformAdmin: z.boolean()
  })

  return { response }
}

export type GuestResponseDto = z.infer<ReturnType<typeof useGuestSchema>['response']>

/**
 * Hook declaration
 */
export const useGuest = () => {
  const schemas = useGuestSchema()

  return useQuery({
    queryKey: ['guestAccess'],
    queryFn: async () => {
      try {
        const response = await authControllerGetGuest()
        const data = schemas.response.parse(response)
        localStorage.setItem('guestAccess', JSON.stringify(data))
        return data
      } catch (error) {
        console.error('Failed to fetch guest access:', error)
        throw error
      }
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
    enabled: false
  })
}
