import { createZodDto } from 'nestjs-zod'
import { buildCreateEntityPayloadSchema } from '@shared-validation/entity'

export class CreateEntityDto extends createZodDto(buildCreateEntityPayloadSchema()) {}
