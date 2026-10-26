// A message's attachments: a tile per file (preview, download, save to a plugin), and the
// full-screen preview for images, PDFs and text files.
import { Download, Eye, FileText, Image, X } from 'lucide-react'
import { useState } from 'react'
import { formatSize } from '../../lib/format'
import type { Attachment, Message } from '../../types'
import { SaveToMenu } from '../SaveToMenu'

export function attachmentUrl(messageId: string, file: Attachment, download = false) {
  return `/api/messages/${messageId}/attachments/${file.id}${download ? '?download' : ''}`
}

// The types browsers can show safely inside Nexus. Anything else is only offered as a download.
const PREVIEWABLE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain']

// Thumbnails are the real image, and each one makes the server re-read the whole email, so only
// small images get one.
const MAX_THUMBNAIL_BYTES = 1_000_000

export function Attachments({ message }: { message: Message }) {
  const [preview, setPreview] = useState<Attachment | null>(null)
  if (message.attachments.length === 0) return null
  const count = message.attachments.length

  return (
    <div className="grid gap-2">
      <h2 className="text-[12px] font-semibold text-muted">
        {count} {count === 1 ? 'attachment' : 'attachments'}
      </h2>
      <div className="grid gap-2.5 @2xl:grid-cols-2">
        {message.attachments.map((file) => (
          <AttachmentTile
            key={file.id}
            messageId={message.id}
            file={file}
            // Drafts and scheduled mail aren't stored as emails yet, so their files can't be opened here.
            stored={!message.outgoing}
            onPreview={() => setPreview(file)}
          />
        ))}
      </div>
      {preview && <AttachmentPreview messageId={message.id} file={preview} onClose={() => setPreview(null)} />}
    </div>
  )
}

function AttachmentTile(props: { messageId: string; file: Attachment; stored: boolean; onPreview: () => void }) {
  const { messageId, file, stored, onPreview } = props
  const isImage = file.contentType.startsWith('image/')
  const previewable = stored && PREVIEWABLE_TYPES.includes(file.contentType)
  const showThumbnail = isImage && previewable && file.size <= MAX_THUMBNAIL_BYTES
  const Icon = isImage ? Image : FileText

  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-raise p-2.5">
      <button
        type="button"
        onClick={onPreview}
        disabled={!previewable}
        aria-label={`Preview ${file.filename}`}
        className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-lg bg-line/60 text-muted enabled:hover:text-ink"
      >
        {showThumbnail ? (
          <img src={attachmentUrl(messageId, file)} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <Icon size={18} />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate">{file.filename}</p>
        <p className="text-[12px] text-muted">{formatSize(file.size)}</p>
      </div>
      {previewable && (
        <button
          type="button"
          onClick={onPreview}
          aria-label={`Preview ${file.filename}`}
          className="rounded-lg p-1.5 text-muted hover:bg-hover hover:text-ink"
        >
          <Eye size={15} />
        </button>
      )}
      {stored && (
        <>
          <a
            href={attachmentUrl(messageId, file, true)}
            aria-label={`Download ${file.filename}`}
            className="rounded-lg p-1.5 text-muted hover:bg-hover hover:text-ink"
          >
            <Download size={15} />
          </a>
          <SaveToMenu messageId={messageId} attachmentId={file.id} filename={file.filename} compact />
        </>
      )}
    </div>
  )
}

function AttachmentPreview({ messageId, file, onClose }: { messageId: string; file: Attachment; onClose: () => void }) {
  const url = attachmentUrl(messageId, file)
  // Clicking the dark background closes the preview; clicks on the file itself don't.
  const stayOpen = (event: React.MouseEvent) => event.stopPropagation()

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/85"
      role="dialog"
      aria-modal="true"
      aria-label={`Preview of ${file.filename}`}
    >
      <header className="flex items-center gap-3 px-4 py-3 text-white">
        <span className="truncate font-semibold">{file.filename}</span>
        <span className="text-[12px] text-white/70">{formatSize(file.size)}</span>
        <div className="ml-auto flex items-center gap-2">
          <SaveToMenu messageId={messageId} attachmentId={file.id} filename={file.filename} />
          <a
            href={attachmentUrl(messageId, file, true)}
            className="flex items-center gap-1.5 rounded-lg border border-line bg-raise px-3 py-1.5 text-[13px] text-ink"
          >
            <Download size={15} /> Download
          </a>
          <button
            type="button"
            aria-label="Close preview"
            onClick={onClose}
            className="rounded-lg p-2 hover:bg-white/10"
          >
            <X size={18} />
          </button>
        </div>
      </header>
      <div className="grid min-h-0 flex-1 place-items-center p-4 md:p-8" onClick={onClose}>
        {file.contentType.startsWith('image/') ? (
          <img
            src={url}
            alt={file.filename}
            className="max-h-full max-w-full rounded-lg object-contain"
            onClick={stayOpen}
          />
        ) : (
          // The server sends text files with a sandbox policy; PDFs open in the browser's own viewer.
          <iframe
            title={file.filename}
            src={url}
            className="h-full w-full max-w-4xl rounded-lg bg-white"
            onClick={stayOpen}
          />
        )}
      </div>
    </div>
  )
}
