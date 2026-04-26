import { z } from 'zod'

export const sharedValidationPlaceholderSchema = z.object({
  id: z.string()
})

export type SharedValidationPlaceholder = z.infer<typeof sharedValidationPlaceholderSchema>
