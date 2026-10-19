import { ImageOff } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { buildSafeEmailDocument } from '../lib/sanitize'
import { Button } from './ui'

// Renders email HTML in a sandboxed iframe. No allow-scripts, so nothing in the email can run.
// allow-same-origin is only there so we can read the content height; without scripts it grants nothing.
export function SafeHtml({ html }: { html: string }) {
  const [allowImages, setAllowImages] = useState(false)
  const [height, setHeight] = useState(200)
  const frame = useRef<HTMLIFrameElement>(null)
  const safe = useMemo(() => buildSafeEmailDocument(html, allowImages), [html, allowImages])

  const watcher = useRef<ResizeObserver | null>(null)

  // Size the frame to its content, and keep doing so: rotating a phone or narrowing the window
  // re-wraps the text, and the frame hides its own scrollbar, so a stale height would cut the end off.
  function fitHeight() {
    const doc = frame.current?.contentDocument
    if (!doc?.body) return
    const fit = () => setHeight(doc.documentElement.scrollHeight)
    watcher.current?.disconnect()
    watcher.current = new ResizeObserver(fit)
    watcher.current.observe(doc.body)
    fit()
  }
  useEffect(() => () => watcher.current?.disconnect(), [])

  return (
    <div className="grid gap-3">
      {safe.blockedImages > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-line bg-raise px-3.5 py-2.5 text-[13px] text-ink-2">
          <ImageOff size={16} className="shrink-0 text-muted" />
          <span className="min-w-0 flex-1">Remote images blocked <span className="sm:hidden">for privacy</span><span className="hidden sm:inline">to stop tracking</span>.</span>
          <Button variant="ghost" className="shrink-0" onClick={() => setAllowImages(true)}>Load images</Button>
        </div>
      )}
      <iframe
        ref={frame}
        title="Message content"
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        srcDoc={safe.html}
        onLoad={fitHeight}
        style={{ height }}
        className="w-full rounded-xl bg-white"
      />
    </div>
  )
}
