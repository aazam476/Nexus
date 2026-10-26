// The keyboard shortcuts overlay, opened with ?.
import { X } from 'lucide-react'
import { Kbd } from './ui'

const shortcuts = [
  ['j / k', 'Next / previous message'],
  ['Enter', 'Open message'],
  ['e', 'Archive'],
  ['#', 'Delete'],
  ['s', 'Star'],
  ['u', 'Mark unread'],
  ['!', 'Mark as spam'],
  ['r', 'Reply'],
  ['a', 'Reply all'],
  ['f', 'Forward'],
  ['c', 'New message'],
  ['/', 'Search'],
  [',', 'Settings'],
  ['?', 'This help'],
]

export function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-line bg-panel shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 id="shortcuts-title" className="text-[15px] font-semibold">
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-md p-1 text-muted hover:bg-raise"
          >
            <X size={16} />
          </button>
        </header>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 px-5 py-4">
          {shortcuts.map(([key, label]) => (
            <div key={key} className="flex items-center justify-between gap-3">
              <dt className="text-ink-2">{label}</dt>
              <dd>
                <Kbd>{key}</Kbd>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}
