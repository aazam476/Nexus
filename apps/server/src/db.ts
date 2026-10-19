import { PrismaClient } from '@prisma/client'

// One shared connection pool for the whole app.
export const db = new PrismaClient()
