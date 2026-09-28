/**
 * Resources
 */
import { Module } from '@nestjs/common'

/**
 * Dependencies
 */
import { CommonModule } from '@common/common.module'
import { UserController } from '@modules/users/controllers/user.controller'
import { UserPreferencesService } from '@modules/users/services/user-preferences.service'

/**
 * Declaration
 */
@Module({
  imports: [CommonModule],
  controllers: [UserController],
  providers: [UserPreferencesService],
  exports: [UserPreferencesService]
})
export class UsersModule {}
