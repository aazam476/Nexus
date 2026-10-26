// The files added to a message, each with a button to take it off again.
import { Paperclip, X } from 'lucide-react'
import { formatSize } from '../../lib/format'

export function AttachedFiles({ files, onRemove }: { files: File[]; onRemove: (file: File) => void }) {
  if (files.length === 0) return null
  return (
    <ul className="flex flex-wrap gap-2 px-4 pb-2">
      {files.map((file) => (
        <li
          key={file.name}
          className="flex items-center gap-2 rounded-lg border border-line bg-raise px-2.5 py-1.5 text-[13px]"
        >
          <Paperclip size={13} className="text-muted" />
          {file.name} <span className="text-muted">{formatSize(file.size)}</span>
          <button
            type="button"
            aria-label={`Remove ${file.name}`}
            onClick={() => onRemove(file)}
            className="text-muted hover:text-ink"
          >
            <X size={13} />
          </button>
        </li>
      ))}
    </ul>
  )
}
