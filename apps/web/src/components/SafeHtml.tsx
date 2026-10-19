import { ImageOff } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { buildSafeEmailDocument } from '../lib/sanitize'
import { Button } from './ui'

// Renders email HTML in a sandboxed iframe. No allow-scripts, so nothing in the email can run.
// allow-same-origin is only there so we can read the content height; without scripts it grants nothing.
export function SafeHtml({ html }: { html: string }) {
  const [allowImages, setAllowImages] = useState(false)
  const [height, setHeight] = useState(200)
  const frame = useRef<HTMLIFrameElement>(null)
  const safe = useMemo(() => buildSafeEmailDocument(html, allowImages), [html, allowImages])

  function fitHeight() {
    const root = frame.current?.contentDocument?.documentElement
    if (root) setHeight(root.scrollHeight)
  }

  return (
    <div className="grid gap-3">
      {safe.blockedImages > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-raise px-3.5 py-2.5 text-[13px] text-ink-2">
          <ImageOff size={16} className="text-muted" />
          Remote images blocked to stop tracking.
          <Button variant="ghost" className="ml-auto" onClick={() => setAllowImages(true)}>Load images</Button>
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
