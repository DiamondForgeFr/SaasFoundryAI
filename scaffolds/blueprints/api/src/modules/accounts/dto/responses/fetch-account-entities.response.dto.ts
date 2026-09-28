import { PaginatedResponseDto } from '@common/dto/responses/pagination.response.dto'
import { ApiProperty } from '@nestjs/swagger'
import { AccountEntityListItemDto } from './fetch_account.response.dto'

export class FetchAccountEntitiesResponseDto extends PaginatedResponseDto<AccountEntityListItemDto> {
  @ApiProperty({
    description: 'List of entities',
    type: [AccountEntityListItemDto]
  })
  items: AccountEntityListItemDto[]
}
