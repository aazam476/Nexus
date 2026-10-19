// Brings an account's mail into Nexus. IMAP: two-way (new mail in, read/star/delete state kept in step).
// POP3: one-way download; folders and flags only exist in Nexus.
import type { Account, Folder } from '@prisma/client'
import type { ImapFlow, ListResponse } from 'imapflow'
import { db } from '../../db.ts'
import { openPop3, pop3Retrieve, withImap } from '../accounts/connect.ts'
import { parseRaw } from './parse.ts'
import { classify } from './sorting.ts'
import { loadSortingContext, saveMessage, sortIncoming, type SortingContext } from './store.ts'

// shortcut: the first sync of a folder only fetches its newest messages; add a "load older mail" job for full history.
const FIRST_SYNC_LIMIT = 500
const ROLES = ['inbox', 'sent', 'drafts', 'archive', 'spam', 'trash'] as const

export async function syncAccount(accountId: string) {
  const account = await db.account.findUnique({ where: { id: accountId } })
  if (!account) return
  try {
    const context = await loadSortingContext(account.ownerId)
    if (account.protocol === 'imap') await syncImap(account, context)
    else await syncPop3(account, context)
    await db.account.update({ where: { id: account.id }, data: { lastSyncAt: new Date(), syncError: null } })
  } catch (error) {
    await db.account.update({ where: { id: account.id }, data: { syncError: (error as Error).message } })
    throw error
  }
}

// ---------- IMAP ----------

async function syncImap(account: Account, context: SortingContext) {
  await withImap(account, async (client) => {
    const folders = await discoverFolders(client, account.id)
    // Inbox first: it may move mail into spam/archive, which those folders then pick up in this same run.
    for (const role of ROLES) {
      const folder = folders.get(role)
      if (folder) await syncFolder(client, account, folder, folders, context)
    }
  })
}

const specialUse: Record<string, (typeof ROLES)[number]> = {
  '\\Inbox': 'inbox', '\\Sent': 'sent', '\\Drafts': 'drafts', '\\Archive': 'archive', '\\All': 'archive', '\\Junk': 'spam', '\\Trash': 'trash',
}
const byName: [RegExp, (typeof ROLES)[number]][] = [
  [/^inbox$/i, 'inbox'], [/^sent/i, 'sent'], [/^drafts?$/i, 'drafts'], [/^archive/i, 'archive'], [/junk|spam/i, 'spam'], [/trash|deleted/i, 'trash'],
]

// Matches server mailboxes to Nexus folder roles, creating Archive/Spam/Trash/Sent if the server lacks them.
export async function discoverFolders(client: ImapFlow, accountId: string): Promise<Map<string, Folder>> {
  const mailboxes: ListResponse[] = await client.list()
  const pathFor = new Map<string, string>()
  for (const box of mailboxes) {
    const role = (box.specialUse && specialUse[box.specialUse]) || byName.find(([pattern]) => pattern.test(box.name))?.[1]
    if (role && !pathFor.has(role)) pathFor.set(role, box.path)
  }
  for (const [role, name] of [['sent', 'Sent'], ['archive', 'Archive'], ['spam', 'Junk'], ['trash', 'Trash']] as const) {
    if (!pathFor.has(role)) {
      const created = await client.mailboxCreate(name)
      pathFor.set(role, created.path)
    }
  }

  const folders = new Map<string, Folder>()
  for (const [role, path] of pathFor) {
    const folder = await db.folder.upsert({
      where: { accountId_role: { accountId, role } },
      create: { accountId, role, path },
      update: { path },
    })
    folders.set(role, folder)
  }
  return folders
}

async function syncFolder(client: ImapFlow, account: Account, folder: Folder, folders: Map<string, Folder>, context: SortingContext) {
  const lock = await client.getMailboxLock(folder.path)
  try {
    const mailbox = client.mailbox
    if (!mailbox) return
    let lastUid = folder.lastUid

    // UIDVALIDITY changed: the server renumbered everything, so start this folder over.
    if (folder.uidValidity != null && folder.uidValidity !== mailbox.uidValidity) {
      await db.message.deleteMany({ where: { folderId: folder.id } })
      lastUid = 0
    }

    // 1. Find new messages. List UIDs first; fetch each body separately so big attachments
    //    never pile up in memory, and because imapflow can't run other commands mid-fetch.
    const newUids: number[] = []
    if (mailbox.exists > 0) {
      const range = lastUid > 0 ? `${lastUid + 1}:*` : `${Math.max(1, mailbox.exists - FIRST_SYNC_LIMIT + 1)}:*`
      for await (const message of client.fetch(range, { uid: true }, { uid: lastUid > 0 })) {
        if (message.uid > lastUid) newUids.push(message.uid) // "N:*" always returns the last message, even if old
      }
    }

    for (const uid of newUids) {
      const message = await client.fetchOne(String(uid), { source: true, flags: true }, { uid: true })
      if (!message || !message.source) continue
      const parsed = await parseRaw(message.source)
      const flags = message.flags ?? new Set<string>()
      let unread = !flags.has('\\Seen')
      let category = classify({ fromEmail: parsed.from.email, subject: parsed.subject, isMailingList: parsed.isMailingList, isAutomated: parsed.isAutomated, hasEvent: !!parsed.event })
      let labels: string[] = []

      if (folder.role === 'inbox') {
        const decision = sortIncoming(parsed, context)
        const target = decision.moveTo && folders.get(decision.moveTo)
        if (target && target.id !== folder.id) {
          // Move it on the server; the target folder's sync picks it up later in this run.
          await client.messageMove(String(uid), target.path, { uid: true })
          continue
        }
        if (decision.markRead && unread) {
          await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true })
          unread = false
        }
        category = decision.category
        labels = decision.labels
      }

      await saveMessage({ accountId: account.id, folderId: folder.id, raw: message.source, parsed, uid, unread, starred: flags.has('\\Flagged'), category, labels })
    }

    // 2. Bring flags and deletions made in other mail apps into Nexus.
    const local = await db.message.findMany({ where: { folderId: folder.id }, select: { id: true, uid: true, unread: true, starred: true } })
    if (local.length) {
      const remote = new Map<number, Set<string>>()
      if (mailbox.exists > 0) {
        for await (const message of client.fetch('1:*', { uid: true, flags: true })) remote.set(message.uid, message.flags ?? new Set())
      }
      const gone = local.filter((m) => m.uid == null || !remote.has(m.uid)).map((m) => m.id)
      if (gone.length) await db.message.deleteMany({ where: { id: { in: gone } } })
      for (const message of local) {
        const flags = message.uid != null ? remote.get(message.uid) : undefined
        if (!flags) continue
        const unread = !flags.has('\\Seen')
        const starred = flags.has('\\Flagged')
        if (unread !== message.unread || starred !== message.starred) {
          await db.message.update({ where: { id: message.id }, data: { unread, starred } })
        }
      }
    }

    await db.folder.update({
      where: { id: folder.id },
      data: { uidValidity: mailbox.uidValidity, lastUid: Math.max(lastUid, ...newUids, 0) },
    })
  } finally {
    lock.release()
  }
}

// ---------- POP3 ----------

// POP3 has a single mailbox. Nexus keeps local folders for everything else.
export async function localFolders(accountId: string): Promise<Map<string, Folder>> {
  const folders = new Map<string, Folder>()
  for (const role of ROLES) {
    const folder = await db.folder.upsert({ where: { accountId_role: { accountId, role } }, create: { accountId, role, path: role }, update: {} })
    folders.set(role, folder)
  }
  return folders
}

async function syncPop3(account: Account, context: SortingContext) {
  const folders = await localFolders(account.id)
  const known = new Set((await db.message.findMany({ where: { accountId: account.id, remoteId: { not: null } }, select: { remoteId: true } })).map((m) => m.remoteId))
  const pop3 = openPop3(account)
  try {
    const list = (await pop3.UIDL()) as [string, string][]
    for (const [number, uidl] of list) {
      if (known.has(uidl)) continue
      const raw = await pop3Retrieve(pop3, Number(number))
      const parsed = await parseRaw(raw)
      const decision = sortIncoming(parsed, context)
      const folder = folders.get(decision.moveTo ?? 'inbox') ?? folders.get('inbox')!
      await saveMessage({ accountId: account.id, folderId: folder.id, raw, parsed, remoteId: uidl, unread: !decision.markRead, starred: false, category: decision.category, labels: decision.labels })
    }
  } finally {
    await pop3.QUIT().catch(() => undefined)
  }
}
