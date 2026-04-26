import { createZodDto } from 'nestjs-zod'
import { buildResetPasswordPayloadSchema } from '@shared-validation/auth'

export class ResetPasswordDto extends createZodDto(buildResetPasswordPayloadSchema()) {}
