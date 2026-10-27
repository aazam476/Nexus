// Brings an account's mail into Nexus. IMAP: two-way (new mail in, read/star/delete state kept in step).
// POP3: one-way download; folders and flags only exist in Nexus.
import type { Account, Folder } from '@prisma/client'
import type { ImapFlow, ListResponse } from 'imapflow'
import { db } from '../../db.ts'
import { errorMessage } from '../../lib/http.ts'
import { openPop3, withImap } from '../accounts/connect.ts'
import { parseRaw } from './parse.ts'
import { sealAccounts } from './private.ts'
import { categoryOf, nothingChanged } from './sorting.ts'
import { loadSortingContext, saveMessage, sortIncoming, type SortingContext } from './store.ts'

// How much mail each sync downloads. A folder's first sync takes its newest messages, so they show
// up quickly; every sync after that also takes the next batch of older ones, until the folder's
// whole history is in. (Tests lower these, to try it with a handful of messages.)
export const syncLimits = { firstSync: 500, historyBatch: 500 }
const ROLES = ['inbox', 'sent', 'drafts', 'archive', 'spam', 'trash'] as const

export async function syncAccount(accountId: string) {
  const account = await db.account.findUnique({ where: { id: accountId } })
  if (!account) return
  try {
    const context = await loadSortingContext(account.ownerId)
    // Private storage: seal any mail still readable before talking to the mail server, so it happens
    // even when the server is down. (Turning private storage on relies on this; see auth/routes.ts.)
    if (context.sealFor) await sealAccounts([account.id], context.sealFor)
    if (account.protocol === 'imap') await syncImap(account, context)
    else await syncPop3(account, context)
    // And once more after: a sync that began just before private storage was turned on stored mail unsealed.
    if (context.sealFor) await sealAccounts([account.id], context.sealFor)
    await db.account.update({ where: { id: account.id }, data: { lastSyncAt: new Date(), syncError: null } })
  } catch (error) {
    await db.account.update({ where: { id: account.id }, data: { syncError: errorMessage(error) } })
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

// How a server folder is recognised. Most servers tag their special folders ("special-use" flags
// like \Sent), whatever they're called in the user's language. Older ones don't, so the folder
// name is the fallback.
type Role = (typeof ROLES)[number]
const roleBySpecialUse: Record<string, Role> = {
  '\\Inbox': 'inbox',
  '\\Sent': 'sent',
  '\\Drafts': 'drafts',
  '\\Archive': 'archive',
  '\\Junk': 'spam',
  '\\Trash': 'trash',
}
const roleByName: [RegExp, Role][] = [
  [/^inbox$/i, 'inbox'], // exactly "INBOX"
  [/^sent/i, 'sent'], // "Sent", "Sent Items", "Sent Messages"
  [/^drafts?$/i, 'drafts'], // "Draft" or "Drafts"
  [/^archive/i, 'archive'], // "Archive", "Archives"
  [/junk|spam/i, 'spam'], // anything mentioning junk or spam
  [/trash|deleted/i, 'trash'], // "Trash", "Deleted Items"
]
// Folders Nexus needs on every account, and the name to create them with when the server has none.
const REQUIRED_FOLDERS: [Role, string][] = [
  ['sent', 'Sent'],
  ['archive', 'Archive'],
  ['spam', 'Junk'],
  ['trash', 'Trash'],
]

function roleOf(mailbox: ListResponse): Role | undefined {
  if (mailbox.specialUse && roleBySpecialUse[mailbox.specialUse]) return roleBySpecialUse[mailbox.specialUse]
  return roleByName.find(([pattern]) => pattern.test(mailbox.name))?.[1]
}

// Matches the server's mailboxes to Nexus folder roles, creating Sent/Archive/Junk/Trash if missing.
export async function discoverFolders(client: ImapFlow, accountId: string): Promise<Map<string, Folder>> {
  const pathFor = new Map<string, string>() // role → the mailbox's path on the server
  for (const mailbox of await client.list()) {
    const role = roleOf(mailbox)
    if (role && !pathFor.has(role)) pathFor.set(role, mailbox.path) // the first match wins
  }
  for (const [role, name] of REQUIRED_FOLDERS) {
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

// Syncs one folder: new mail, then a batch of older mail, then changes made in other apps.
// Some IMAP words used below:
//   UID          a number the server gives each message in a folder; new messages get higher ones,
//                so "UIDs above the last one we saw" means "new mail"
//   UIDVALIDITY  changes if the server ever renumbers the folder; then our saved UIDs are worthless
//   flags        \Seen (read) and \Flagged (starred), set by any mail app
//   exists       how many messages the folder holds right now
async function syncFolder(
  client: ImapFlow,
  account: Account,
  folder: Folder,
  folders: Map<string, Folder>,
  context: SortingContext,
) {
  // The lock stops other commands (from this connection) using the folder while we work in it.
  const lock = await client.getMailboxLock(folder.path)
  try {
    const mailbox = client.mailbox
    if (!mailbox) return
    let lastUid = folder.lastUid
    let oldestUid = folder.oldestUid
    if (folder.uidValidity != null && folder.uidValidity !== mailbox.uidValidity) {
      // The server renumbered everything: forget this folder and download it again.
      await db.message.deleteMany({ where: { folderId: folder.id } })
      lastUid = 0
      oldestUid = null
    }

    const newUids = await findNewUids(client, lastUid, mailbox.exists)
    for (const uid of newUids) await downloadMessage(client, uid, account, folder, folders, context)

    // Where older mail still to fetch begins: below the oldest message the first sync took (or,
    // for folders synced before Nexus fetched history, below the oldest one stored).
    if (lastUid === 0 && newUids.length > 0) oldestUid = Math.min(...newUids)
    oldestUid ??= await oldestStoredUid(folder.id, lastUid)
    oldestUid = await downloadOlderMail(client, account, folder, folders, context, oldestUid)

    const unchanged = nothingChanged(
      folder,
      { highestModseq: mailbox.highestModseq ?? null, exists: mailbox.exists },
      newUids.length,
    )
    if (!unchanged) await copyChangesFromServer(client, folder, mailbox.exists)

    await db.folder.update({
      where: { id: folder.id },
      data: {
        uidValidity: mailbox.uidValidity,
        lastUid: Math.max(lastUid, ...newUids),
        oldestUid,
        highestModseq: mailbox.highestModseq ?? null,
        lastExists: mailbox.exists,
      },
    })
  } finally {
    lock.release()
  }
}

// Step 1: which messages are new. Only UIDs are fetched here; bodies come one at a time in step 2,
// so big attachments never pile up in memory (and imapflow can't run other commands mid-fetch).
async function findNewUids(client: ImapFlow, lastUid: number, exists: number): Promise<number[]> {
  if (exists === 0) return []
  // "A:*" means "from A to the end". After a first sync, ask by UID for everything above the last
  // one seen. On the first sync, ask by position for the newest syncLimits.firstSync messages.
  const firstSync = lastUid === 0
  const range = firstSync ? `${Math.max(1, exists - syncLimits.firstSync + 1)}:*` : `${lastUid + 1}:*`
  const uids: number[] = []
  for await (const message of client.fetch(range, { uid: true }, { uid: !firstSync })) {
    // "N:*" always includes the very last message, even when it isn't new, so check.
    if (message.uid > lastUid) uids.push(message.uid)
  }
  return uids
}

// Step 1b: older mail. Fetches up to syncLimits.historyBatch messages from just below `oldestUid`,
// newest of them first. Returns the new oldest UID; 1 means the whole history is in.
async function downloadOlderMail(
  client: ImapFlow,
  account: Account,
  folder: Folder,
  folders: Map<string, Folder>,
  context: SortingContext,
  oldestUid: number,
): Promise<number> {
  if (oldestUid <= 1) return 1 // done already
  const older = (await client.search({ uid: `1:${oldestUid - 1}` }, { uid: true })) || [] // every UID below it
  if (older.length === 0) return 1
  const batch = older.sort((a, b) => a - b).slice(-syncLimits.historyBatch) // the newest of the older ones
  for (const uid of batch) await downloadMessage(client, uid, account, folder, folders, context, { applyRules: false })
  const moreLeft = older.length > batch.length
  return moreLeft ? batch[0] : 1
}

// The lowest UID stored for a folder, or (when none are) the next UID to come.
async function oldestStoredUid(folderId: string, lastUid: number): Promise<number> {
  const { _min } = await db.message.aggregate({ where: { folderId }, _min: { uid: true } })
  return _min.uid ?? lastUid + 1
}

// Step 2: download one new message, sort it (inbox only), and save it.
async function downloadMessage(
  client: ImapFlow,
  uid: number,
  account: Account,
  folder: Folder,
  folders: Map<string, Folder>,
  context: SortingContext,
  options = { applyRules: true },
) {
  const message = await client.fetchOne(String(uid), { source: true, flags: true }, { uid: true })
  if (!message || !message.source) return
  const parsed = await parseRaw(message.source)
  const flags = message.flags ?? new Set<string>()
  let unread = !flags.has('\\Seen')
  let category = categoryOf(parsed)
  let labels: string[] = []

  // New mail in the inbox goes through the user's rules and the spam check. (Older mail fetched
  // later doesn't: it was already filed, and the rules weren't there when it arrived.)
  if (folder.role === 'inbox' && options.applyRules) {
    const decision = sortIncoming(parsed, context)
    const target = decision.moveTo && folders.get(decision.moveTo)
    if (target && target.id !== folder.id) {
      // Move it on the server; syncing the target folder picks it up later in this same run.
      await client.messageMove(String(uid), target.path, { uid: true })
      return
    }
    if (decision.markRead && unread) {
      await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true })
      unread = false
    }
    category = decision.category
    labels = decision.labels
  }

  await saveMessage({
    accountId: account.id,
    folderId: folder.id,
    raw: message.source,
    parsed,
    uid,
    unread,
    starred: flags.has('\\Flagged'),
    category,
    labels,
    sealFor: context.sealFor,
  })
}

// Step 3: copy what other mail apps changed (read, starred, deleted) into Nexus.
async function copyChangesFromServer(client: ImapFlow, folder: Folder, exists: number) {
  const local = await db.message.findMany({
    where: { folderId: folder.id },
    select: { id: true, uid: true, unread: true, starred: true },
  })
  if (!local.length) return

  // Every message's UID and flags, as the server has them now.
  const remote = new Map<number, Set<string>>()
  if (exists > 0) {
    for await (const message of client.fetch('1:*', { uid: true, flags: true })) {
      remote.set(message.uid, message.flags ?? new Set())
    }
  }

  // Gone from the server: deleted (or moved) in another app.
  const gone = local.filter((m) => m.uid == null || !remote.has(m.uid)).map((m) => m.id)
  if (gone.length) await db.message.deleteMany({ where: { id: { in: gone } } })

  // Still there: update read and starred if they changed.
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

// ---------- POP3 ----------

// POP3 has a single mailbox. Nexus keeps local folders for everything else.
export async function localFolders(accountId: string): Promise<Map<string, Folder>> {
  const folders = new Map<string, Folder>()
  for (const role of ROLES) {
    const folder = await db.folder.upsert({
      where: { accountId_role: { accountId, role } },
      create: { accountId, role, path: role },
      update: {},
    })
    folders.set(role, folder)
  }
  return folders
}

async function syncPop3(account: Account, context: SortingContext) {
  const folders = await localFolders(account.id)
  // POP3 gives each message a unique id (UIDL). Those already downloaded are skipped.
  const downloaded = await db.message.findMany({
    where: { accountId: account.id, remoteId: { not: null } },
    select: { remoteId: true },
  })
  const known = new Set(downloaded.map((m) => m.remoteId))
  const pop3 = await openPop3(account)
  try {
    for (const [number, uidl] of await pop3.uidl()) {
      if (known.has(uidl)) continue
      const raw = await pop3.retrieve(number)
      const parsed = await parseRaw(raw)
      const decision = sortIncoming(parsed, context)
      const folder = folders.get(decision.moveTo ?? 'inbox') ?? folders.get('inbox')!
      await saveMessage({
        accountId: account.id,
        folderId: folder.id,
        raw,
        parsed,
        remoteId: uidl,
        unread: !decision.markRead,
        starred: false,
        category: decision.category,
        labels: decision.labels,
      })
    }
  } finally {
    await pop3.quit()
  }
}
