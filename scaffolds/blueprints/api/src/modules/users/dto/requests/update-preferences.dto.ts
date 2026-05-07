import { createZodDto } from 'nestjs-zod'
import { buildUpdateUserPreferencesPayloadSchema } from '@shared-validation/user'

export class UpdateUserPreferencesDto extends createZodDto(buildUpdateUserPreferencesPayloadSchema()) {}
