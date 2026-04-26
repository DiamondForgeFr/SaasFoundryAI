import { ApiProperty } from '@nestjs/swagger'

import type { MessageResponse } from '@shared-types/index'

export class SignOutResponseDto implements MessageResponse {
  @ApiProperty({
    description: 'Success message',
    example: 'Successfully signed out'
  })
  message: string
}
