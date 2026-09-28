import { createZodDto } from 'nestjs-zod'
import { buildSignupPayloadSchema } from '@shared-validation/auth'

export class SignUpDto extends createZodDto(buildSignupPayloadSchema()) {}
