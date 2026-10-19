import { Check, CloudUpload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { usePlugins } from '../lib/queries'

// Lists every enabled plugin that can store an attachment (Immich, Nextcloud Files, Paperless, third-party).
export function SaveToMenu({ messageId, attachmentId, filename, compact = false }: { messageId: string; attachmentId: string; filename: string; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<{ busy?: string; savedTo?: string; error?: string }>({})
  const menu = useRef<HTMLDivElement>(null)
  const targets = (usePlugins().data ?? []).filter((p) => p.enabled && p.capabilities.includes('save-attachment'))

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => { if (!menu.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  async function save(pluginId: string, name: string) {
    setOpen(false)
    setState({ busy: name })
    try {
      await api(`/plugins/${pluginId}/save-attachment`, { body: { messageId, attachmentId } })
      setState({ savedTo: name })
    } catch (e) {
      setState({ error: (e as Error).message })
    }
  }

  const label = state.busy ? `Saving to ${state.busy}…` : state.savedTo ? `Saved to ${state.savedTo}` : 'Save to…'
  return (
    <div ref={menu} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Save ${filename} to…`}
        title={state.error ?? label}
        disabled={!!state.busy}
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 rounded-lg text-[13px] hover:bg-hover ${state.error ? 'text-danger' : 'text-ink-2'} ${compact ? 'p-1.5' : 'border border-line bg-raise px-2.5 py-1.5'}`}
      >
        {state.savedTo ? <Check size={15} className="text-news" /> : <CloudUpload size={15} />}
        {!compact && label}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-60 rounded-xl border border-line bg-panel p-1 shadow-pop">
          {targets.map((plugin) => (
            <button key={plugin.id} type="button" role="menuitem" onClick={() => save(plugin.id, plugin.name)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-raise">
              <CloudUpload size={15} className="text-muted" />
              {plugin.name}
            </button>
          ))}
          {targets.length === 0 && <p className="px-2.5 py-2 text-muted">No storage plugins turned on. Set one up in Settings → Plugins.</p>}
          {state.error && <p role="alert" className="border-t border-line px-2.5 py-2 text-[12.5px] text-danger">{state.error}</p>}
        </div>
      )}
    </div>
  )
}
