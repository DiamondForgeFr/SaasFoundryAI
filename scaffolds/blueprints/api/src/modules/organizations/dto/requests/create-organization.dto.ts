import { createZodDto } from 'nestjs-zod'
import { buildCreateOrganizationPayloadSchema } from '@shared-validation/organization'

export class CreateOrganizationDto extends createZodDto(buildCreateOrganizationPayloadSchema()) {}
