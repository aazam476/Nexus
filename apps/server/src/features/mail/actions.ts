// Changing mail: flags, moving between folders, deleting. IMAP changes go to the server first,
// then into the database, so Nexus never shows something the server doesn't agree with.
import type { Account, Folder, Message } from '@prisma/client'
import type { ImapFlow } from 'imapflow'
import { db } from '../../db.ts'
import { badRequest } from '../../lib/http.ts'
import { openPop3, withImap } from '../accounts/connect.ts'
import { discoverFolders, localFolders } from './sync.ts'

type FullMessage = Message & { folder: Folder }

async function onServer(account: Account, message: FullMessage, work: (client: ImapFlow, uid: string) => Promise<void>) {
  if (account.protocol !== 'imap' || message.uid == null) return
  await withImap(account, async (client) => {
    const lock = await client.getMailboxLock(message.folder.path)
    try {
      await work(client, String(message.uid))
    } finally {
      lock.release()
    }
  })
}

export async function setFlags(message: FullMessage, change: { unread?: boolean; starred?: boolean }) {
  const account = await db.account.findUniqueOrThrow({ where: { id: message.accountId } })
  await onServer(account, message, async (client, uid) => {
    const update = async (flag: string, on: boolean) => (on ? client.messageFlagsAdd(uid, [flag], { uid: true }) : client.messageFlagsRemove(uid, [flag], { uid: true }))
    if (change.unread !== undefined) await update('\\Seen', !change.unread)
    if (change.starred !== undefined) await update('\\Flagged', change.starred)
  })
  return db.message.update({ where: { id: message.id }, data: change })
}

export async function moveMessage(message: FullMessage, role: string) {
  if (message.folder.role === role) return message
  const account = await db.account.findUniqueOrThrow({ where: { id: message.accountId } })

  if (account.protocol !== 'imap') {
    const target = (await localFolders(account.id)).get(role)
    if (!target) throw badRequest(`Unknown folder ${role}`)
    return db.message.update({ where: { id: message.id }, data: { folderId: target.id } })
  }

  let newUid: number | undefined
  let target: Folder | undefined
  await withImap(account, async (client) => {
    target = (await discoverFolders(client, account.id)).get(role)
    if (!target) throw badRequest(`Unknown folder ${role}`)
    const lock = await client.getMailboxLock(message.folder.path)
    try {
      const result = await client.messageMove(String(message.uid), target.path, { uid: true })
      newUid = result ? result.uidMap?.get(message.uid!) : undefined
    } finally {
      lock.release()
    }
  })
  // Servers without UIDPLUS don't tell us the new UID: drop our copy and let the next sync fetch it.
  if (newUid == null) {
    await db.message.delete({ where: { id: message.id } })
    return null
  }
  return db.message.update({ where: { id: message.id }, data: { folderId: target!.id, uid: newUid } })
}

// Deleting from Trash removes it for good; deleting anywhere else moves it to Trash.
export async function deleteMessage(message: FullMessage) {
  if (message.folder.role !== 'trash') return moveMessage(message, 'trash')

  const account = await db.account.findUniqueOrThrow({ where: { id: message.accountId } })
  await onServer(account, message, async (client, uid) => {
    await client.messageDelete(uid, { uid: true })
  })
  // POP3: also delete on the server, or the next download would bring it back.
  if (account.protocol === 'pop3' && message.remoteId) {
    const pop3 = openPop3(account)
    try {
      const list = (await pop3.UIDL()) as [string, string][]
      const number = list.find(([, uidl]) => uidl === message.remoteId)?.[0]
      if (number) await pop3.DELE(Number(number))
    } finally {
      await pop3.QUIT().catch(() => undefined)
    }
  }
  await db.message.delete({ where: { id: message.id } })
  return null
}
