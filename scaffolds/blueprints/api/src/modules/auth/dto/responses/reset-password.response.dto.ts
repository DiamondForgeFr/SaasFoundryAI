import { ApiProperty } from '@nestjs/swagger'

import type { MessageResponse } from '@shared-types/index'

export class ResetPasswordResponseDto implements MessageResponse {
  @ApiProperty({
    description: 'Success message',
    example: 'Password successfully reset'
  })
  message: string
}
