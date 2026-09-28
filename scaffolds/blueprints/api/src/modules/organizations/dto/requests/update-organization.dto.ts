import { createZodDto } from 'nestjs-zod'
import { buildUpdateOrganizationPayloadSchema } from '@shared-validation/organization'

export class UpdateOrganizationDto extends createZodDto(buildUpdateOrganizationPayloadSchema()) {}
