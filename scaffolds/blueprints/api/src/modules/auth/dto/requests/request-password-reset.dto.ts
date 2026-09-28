import { createZodDto } from 'nestjs-zod'
import { buildRequestPasswordResetPayloadSchema } from '@shared-validation/auth'

export class RequestPasswordResetDto extends createZodDto(buildRequestPasswordResetPayloadSchema()) {}
