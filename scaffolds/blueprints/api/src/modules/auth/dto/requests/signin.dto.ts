import { createZodDto } from 'nestjs-zod'
import { buildSigninPayloadSchema } from '@shared-validation/auth'

export class SignInDto extends createZodDto(buildSigninPayloadSchema()) {}
