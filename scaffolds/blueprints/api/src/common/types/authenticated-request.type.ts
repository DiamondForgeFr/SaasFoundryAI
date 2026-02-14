import { User } from '@/generated/prisma/client'
import { Request } from 'express'

export interface AuthenticatedRequest extends Request {
  user: User
}
