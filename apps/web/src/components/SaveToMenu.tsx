import { Check, CloudUpload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { plugins } from '../mock/data'

// Lists every enabled plugin that can store an attachment (Immich, Nextcloud Files, Paperless, third-party).
export function SaveToMenu({ filename, compact = false }: { filename: string; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const [savedTo, setSavedTo] = useState<string | null>(null)
  const menu = useRef<HTMLDivElement>(null)
  const targets = plugins.filter((p) => p.enabled && p.capabilities.includes('save-attachment'))

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => { if (!menu.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div ref={menu} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Save ${filename} to…`}
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 rounded-lg text-[13px] text-ink-2 hover:bg-hover ${compact ? 'p-1.5' : 'border border-line bg-raise px-2.5 py-1.5'}`}
      >
        {savedTo ? <Check size={15} className="text-news" /> : <CloudUpload size={15} />}
        {!compact && (savedTo ? `Saved to ${savedTo}` : 'Save to…')}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-56 rounded-xl border border-line bg-panel p-1 shadow-pop">
          {targets.map((plugin) => (
            <button
              key={plugin.id}
              type="button"
              role="menuitem"
              onClick={() => { setSavedTo(plugin.name); setOpen(false) }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-raise"
            >
              <CloudUpload size={15} className="text-muted" />
              {plugin.name}
            </button>
          ))}
          {targets.length === 0 && <p className="px-2.5 py-2 text-muted">No storage plugins enabled. Turn one on in Settings → Plugins.</p>}
        </div>
      )}
    </div>
  )
}
