// Reading one message. This file puts the pieces together; each piece lives in components/message/:
//   MessageToolbar  the buttons on top (reply, archive, spam…)
//   MessageBody     the text, shown safely (or decrypted, for PGP mail)
//   EventCard       a calendar card for bookings found in the email
//   Attachments     the files, with preview, download and "Save to…"
//   ScheduledBar    for scheduled mail: when it goes out, Send now, Cancel
//   SecurityChip    the encrypted/signed badge
import { Reply } from 'lucide-react'
import { forwardDraft, replyDraft } from '../lib/compose'
import { formatFullDate } from '../lib/format'
import { useAccounts, useMessage } from '../lib/queries'
import { useStore } from '../lib/store'
import type { Account, Message } from '../types'
import { Attachments } from './message/Attachments'
import { EventCard } from './message/EventCard'
import { MessageBody } from './message/MessageBody'
import { MessageToolbar, type MessageActions } from './message/MessageToolbar'
import { ScheduledBar } from './message/ScheduledBar'
import { SecurityChip } from './message/SecurityChip'
import { sections } from '../lib/sections'
import { Avatar, Chip } from './ui'

interface Props {
  summary: Message // the list row, shown straight away while the full message loads
  readOnly: boolean
  onBack: () => void
  onRefresh: () => void
  actions: MessageActions
}

export function MessageView({ summary, readOnly, onBack, onRefresh, actions }: Props) {
  const { openComposer } = useStore()
  const detail = useMessage(summary.id)
  // The full message adds the body and other details to the list row. Read and starred come from the
  // row, because the page updates those on the row first (see MailPage, updateLocally).
  const message: Message = { ...summary, ...detail.data, starred: summary.starred, unread: summary.unread }
  const account = useAccounts().data?.find((a) => a.id === message.accountId)

  const reply = (all: boolean) => openComposer(replyDraft(message, { all, ownEmail: account?.email }))
  const forward = () => openComposer(forwardDraft(message))

  return (
    <article className="@container flex h-full flex-col overflow-hidden bg-read" aria-label={message.subject}>
      <MessageToolbar
        message={message}
        readOnly={readOnly}
        actions={actions}
        onBack={onBack}
        onReply={reply}
        onForward={forward}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-[820px] grid-cols-[minmax(0,1fr)] gap-5 px-4 py-6 @xl:px-10">
          <h1 className="text-[23px] leading-tight font-bold tracking-tight text-balance">{message.subject}</h1>
          <Sender message={message} account={account} />
          <Chips message={message} />

          {message.outgoing && message.scheduledFor && (
            <ScheduledBar
              message={message}
              onDone={() => {
                onRefresh()
                onBack()
              }}
            />
          )}

          {detail.isLoading && (
            <p className="text-muted" aria-busy="true">
              Loading message…
            </p>
          )}
          {detail.error && (
            <p role="alert" className="rounded-xl border border-line bg-raise px-4 py-3 text-ink-2">
              {detail.error.message}
            </p>
          )}
          {detail.data && <MessageBody message={message} />}

          {message.event && !message.outgoing && <EventCard messageId={message.id} event={message.event} />}
          <Attachments message={message} />

          {!message.outgoing && (
            <button
              type="button"
              onClick={() => reply(false)}
              className="flex items-center gap-3 rounded-xl border border-line bg-panel px-4 py-3 text-left text-muted hover:border-sel-line"
            >
              <Reply size={16} />
              Reply to {message.from.name.split(' ')[0]}…
            </button>
          )}
        </div>
      </div>
    </article>
  )
}

// Who sent it, who it went to, which of your accounts received it, and when.
function Sender({ message, account }: { message: Message; account: Account | undefined }) {
  const recipients = message.to.map((person) => person.name || person.email).join(', ') || 'undisclosed recipients'
  const date = formatFullDate(message.date)
  return (
    <div className="flex items-center gap-3">
      <Avatar name={message.from.name} size={40} />
      <div className="min-w-0">
        <div className="truncate">
          <b className="font-semibold">{message.from.name}</b>{' '}
          <span className="text-muted">&lt;{message.from.email}&gt;</span>
        </div>
        <div className="truncate text-[12.5px] text-muted">
          to {recipients}
          {account && (
            <>
              {' · '}
              <i
                className="inline-block h-1.5 w-1.5 rounded-full align-middle"
                style={{ background: account.color }}
              />{' '}
              {account.email}
            </>
          )}
        </div>
        {/* In a narrow reader the date goes under the name; in a wide one, on the right. */}
        <time className="block text-[12.5px] text-muted @xl:hidden" dateTime={message.date}>
          {date}
        </time>
      </div>
      <time className="ml-auto hidden shrink-0 text-[12.5px] text-muted @xl:block" dateTime={message.date}>
        {date}
      </time>
    </div>
  )
}

// The section it was sorted into (People, Travel…), its labels, and the security badge.
function Chips({ message }: { message: Message }) {
  const section = sections.find((s) => s.category === message.category)
  const otherLabels = message.labels.filter((label) => label !== section?.title)
  return (
    <div className="flex flex-wrap gap-1.5 empty:hidden">
      {section && !message.outgoing && <Chip color={section.color}>{section.title}</Chip>}
      {otherLabels.map((label) => (
        <Chip key={label} color="var(--muted)">
          {label}
        </Chip>
      ))}
      <SecurityChip message={message} />
    </div>
  )
}
