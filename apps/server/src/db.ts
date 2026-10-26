// The database client. Import `db` from here; never create a second PrismaClient.
import { PrismaClient, type Prisma } from '@prisma/client'

// One shared connection pool for the whole app.
export const db = new PrismaClient()

// For JSON columns (to, cc, attachments, event). Prisma's JSON type can't tell that our own
// interfaces are plain JSON-friendly data, so this says so, in one place.
export const asJson = (value: unknown) => value as Prisma.InputJsonValue
