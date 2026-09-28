import { SHARED_CONFIG_PLACEHOLDER } from '@{{PROJECT_NAME}}/shared-config'
import type { Organization } from '@{{PROJECT_NAME}}/shared-types'
import { buildSignupPayloadSchema } from '@{{PROJECT_NAME}}/shared-validation'

export const SHARED_WIRING_PROOF = {
  config: SHARED_CONFIG_PLACEHOLDER,
  schemaName: buildSignupPayloadSchema().constructor.name
} as const

export type SharedWiringProof = Organization
