import { SHARED_CONFIG_PLACEHOLDER } from '@{{PROJECT_NAME}}/shared-config'
import type { SharedTypesPlaceholder } from '@{{PROJECT_NAME}}/shared-types'
import { sharedValidationPlaceholderSchema } from '@{{PROJECT_NAME}}/shared-validation'

export const SHARED_WIRING_PROOF = {
  config: SHARED_CONFIG_PLACEHOLDER,
  schemaName: sharedValidationPlaceholderSchema.constructor.name
} as const

export type SharedWiringProof = SharedTypesPlaceholder
