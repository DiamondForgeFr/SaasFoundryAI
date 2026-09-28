import { createZodDto } from 'nestjs-zod'
import { buildAcceptInvitationPayloadSchema } from '@shared-validation/invitation'

export class AcceptInvitationDto extends createZodDto(buildAcceptInvitationPayloadSchema()) {}
