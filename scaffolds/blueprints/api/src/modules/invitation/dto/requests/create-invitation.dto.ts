import { createZodDto } from 'nestjs-zod'
import { buildCreateInvitationPayloadSchema } from '@shared-validation/invitation'

export class CreateInvitationDto extends createZodDto(buildCreateInvitationPayloadSchema()) {}
