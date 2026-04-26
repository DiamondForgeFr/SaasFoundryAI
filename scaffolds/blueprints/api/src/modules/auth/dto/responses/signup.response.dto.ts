import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

import type { SignUpResponse } from '@shared-types/index'

export class SignUpResponseDto implements SignUpResponse {
  @ApiProperty({
    description: 'Registration confirmation message',
    example: 'User registration successful. Please check your email for confirmation.'
  })
  message: string

  @ApiPropertyOptional({
    description: 'Account confirmation token (only available in development environment)',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
  })
  confirmationToken?: string
}
