// The row of buttons above an open message: back, reply, forward, archive, spam, delete, unread, star.
import {
  Archive,
  ArrowLeft,
  Forward,
  Inbox,
  MailOpen,
  Reply,
  ReplyAll,
  ShieldAlert,
  ShieldCheck,
  Star,
  Trash2,
} from 'lucide-react'
import { useStore } from '../../lib/store'
import type { FolderRole, Message } from '../../types'

// What the toolbar asks the page to do. MailPage owns these, so the list updates at the same time.
export interface MessageActions {
  move: (to: FolderRole) => void
  remove: () => void
  spam: (spam: boolean) => void
  star: (message: Message) => void
  markUnread: (message: Message) => void
}

interface Props {
  message: Message
  readOnly: boolean // viewers of a shared account can read but not change anything
  actions: MessageActions
  onBack: () => void
  onReply: (all: boolean) => void
  onForward: () => void
}

export function MessageToolbar({ message, readOnly, actions, onBack, onReply, onForward }: Props) {
  const { layout } = useStore()
  const inSpam = message.folder === 'spam'
  const canOrganise = !readOnly && !message.outgoing // drafts and scheduled mail have their own controls

  return (
    <div className="flex items-center gap-0.5 border-b border-line px-2 py-2 @xl:px-4">
      {/* With the list beside the message (wide three-pane layout), Back isn't needed. */}
      <ToolButton
        label="Back"
        icon={ArrowLeft}
        onClick={onBack}
        className={layout === 'three-pane' ? 'lg:hidden' : ''}
      />
      {!message.outgoing && (
        <>
          <ToolButton label="Reply" icon={Reply} onClick={() => onReply(false)} showLabel />
          <ToolButton label="Reply all" icon={ReplyAll} onClick={() => onReply(true)} />
          <ToolButton label="Forward" icon={Forward} onClick={onForward} showLabel />
        </>
      )}
      {canOrganise && (
        <>
          <span className="mx-1 h-5 w-px bg-line" />
          {message.folder === 'inbox' ? (
            <ToolButton label="Archive" icon={Archive} onClick={() => actions.move('archive')} />
          ) : (
            <ToolButton label="Move to Inbox" icon={Inbox} onClick={() => actions.move('inbox')} />
          )}
          <ToolButton
            label={inSpam ? 'Not spam' : 'Mark as spam'}
            icon={inSpam ? ShieldCheck : ShieldAlert}
            onClick={() => actions.spam(!inSpam)}
          />
          <ToolButton
            label={message.folder === 'trash' ? 'Delete forever' : 'Delete'}
            icon={Trash2}
            onClick={actions.remove}
          />
          <ToolButton label="Mark unread" icon={MailOpen} onClick={() => actions.markUnread(message)} />
          <ToolButton
            label={message.starred ? 'Unstar' : 'Star'}
            icon={Star}
            onClick={() => actions.star(message)}
            className={message.starred ? '[&_svg]:fill-notif [&_svg]:text-notif' : ''}
          />
        </>
      )}
      {readOnly && (
        <span className="ml-auto pr-2 text-[12.5px] text-muted">Read-only: shared with you as a viewer</span>
      )}
    </div>
  )
}

interface ToolButtonProps {
  label: string
  icon: typeof Reply
  onClick: () => void
  showLabel?: boolean // also show the word next to the icon, when the reader is wide enough
  className?: string
}

function ToolButton({ label, icon: Icon, onClick, showLabel = false, className = '' }: ToolButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] text-ink-2 hover:bg-raise ${className}`}
    >
      <Icon size={16} strokeWidth={1.8} />
      {showLabel && <span className="hidden @2xl:inline">{label}</span>}
    </button>
  )
}
