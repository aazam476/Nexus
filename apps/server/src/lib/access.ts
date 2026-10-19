// Who may do what with a mail account (ACL).
//   owner  – everything, including sharing and deleting the account
//   editor – read, send, move, delete, change flags
//   viewer – read only
import { db } from '../db.ts'
import { forbidden, notFound } from './http.ts'

export type AccountRole = 'owner' | 'editor' | 'viewer'

const rank: Record<AccountRole, number> = { viewer: 1, editor: 2, owner: 3 }

export async function accountRole(userId: string, accountId: string): Promise<AccountRole | null> {
  const account = await db.account.findUnique({
    where: { id: accountId },
    select: { ownerId: true, members: { where: { userId }, select: { role: true } } },
  })
  if (!account) return null
  if (account.ownerId === userId) return 'owner'
  return (account.members[0]?.role as AccountRole | undefined) ?? null
}

// Throws 404 when the user has no access at all, so account ids can't be probed.
export async function requireAccountRole(userId: string, accountId: string, needed: AccountRole) {
  const role = await accountRole(userId, accountId)
  if (!role) throw notFound('Account')
  if (rank[role] < rank[needed]) throw forbidden(`You need ${needed} access to this account`)
  return role
}

export async function accessibleAccounts(userId: string) {
  const accounts = await db.account.findMany({
    where: { OR: [{ ownerId: userId }, { members: { some: { userId } } }] },
    include: { members: { where: { userId }, select: { role: true } } },
    orderBy: { createdAt: 'asc' },
  })
  return accounts.map((account) => ({
    account,
    role: (account.ownerId === userId ? 'owner' : account.members[0].role) as AccountRole,
  }))
}

// Loads a message and checks the user's role on its account in one go.
export async function requireMessage(userId: string, messageId: string, needed: AccountRole) {
  const message = await db.message.findUnique({ where: { id: messageId }, include: { folder: true } })
  if (!message) throw notFound('Message')
  await requireAccountRole(userId, message.accountId, needed)
  return message
}
