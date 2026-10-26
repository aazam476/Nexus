// The database client. Import `db` from here; never create a second PrismaClient.
import { PrismaClient } from '@prisma/client'

// One shared connection pool for the whole app.
export const db = new PrismaClient()
