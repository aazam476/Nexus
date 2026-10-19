import { Bold, ImagePlus, Italic, Link2, List, ListOrdered, Quote, Underline } from 'lucide-react'
import { useEffect, useMemo, useRef, type ClipboardEvent, type DragEvent } from 'react'
import type { BodyMode } from '../lib/compose'
import { buildSafeEmailDocument } from '../lib/sanitize'

// Fonts that render the same in nearly every mail client.
const fonts = [
  { label: 'Sans serif', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Serif', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Monospace', value: '"Courier New", Courier, monospace' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Helvetica', value: 'Helvetica, Arial, sans-serif' },
  { label: 'Tahoma', value: 'Tahoma, sans-serif' },
  { label: 'Times New Roman', value: '"Times New Roman", serif' },
  { label: 'Trebuchet MS', value: '"Trebuchet MS", sans-serif' },
  { label: 'Verdana', value: 'Verdana, sans-serif' },
]

interface Props {
  mode: BodyMode
  content: string
  // Bumped by the composer whenever it replaces the content (mode switch, signature change),
  // so the rich editor knows to reload instead of keeping what the user typed.
  version: number
  onChange: (content: string) => void
  onModeChange: (mode: BodyMode) => void
}

export function BodyEditor({ mode, content, version, onChange, onModeChange }: Props) {
  return (
    <>
      <div className="flex items-center gap-0.5 border-b border-line px-3 py-1 text-muted">
        {mode === 'rich' && <RichToolbar />}
        <button
          type="button"
          aria-pressed={mode === 'source'}
          title={mode === 'source' ? 'Back to rich text' : 'Edit the HTML source'}
          onClick={() => onModeChange(mode === 'source' ? 'rich' : 'source')}
          className={`ml-auto rounded-md px-2.5 py-1 text-[12px] ${mode === 'source' ? 'bg-raise font-semibold text-ink' : 'hover:bg-raise hover:text-ink'}`}
        >
          HTML
        </button>
      </div>

      {mode === 'rich' && <RichEditor content={content} version={version} onChange={onChange} />}
      {mode === 'source' && <SourceEditor content={content} onChange={onChange} />}
    </>
  )
}

// shortcut: execCommand is deprecated but still supported everywhere; replace with a small editor lib if formatting needs grow.
const run = (command: string, value?: string) => document.execCommand(command, false, value)

// Opening a native <select> moves focus out of the editor, so remember the selection and put it back.
let savedRange: Range | null = null

const editorAround = (range: Range) => {
  const node = range.commonAncestorContainer
  return (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>('[contenteditable]')
}

function saveSelection() {
  const selection = window.getSelection()
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null
  savedRange = range && editorAround(range) ? range : null
}

function restoreSelection() {
  if (!savedRange) return
  editorAround(savedRange)?.focus()
  window.getSelection()?.removeAllRanges()
  window.getSelection()?.addRange(savedRange)
}

function insertImages(files: Iterable<File>) {
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue
    const reader = new FileReader()
    // Inline as a data: URL while composing; the server turns these into cid: attachments on send.
    reader.onload = () => run('insertHTML', `<img src="${reader.result}" alt="${file.name.replace(/"/g, '')}" style="max-width:100%">`)
    reader.readAsDataURL(file)
  }
}

function RichToolbar() {
  const picker = useRef<HTMLInputElement>(null)
  const tools = [
    { icon: Bold, label: 'Bold', action: () => run('bold') },
    { icon: Italic, label: 'Italic', action: () => run('italic') },
    { icon: Underline, label: 'Underline', action: () => run('underline') },
    { icon: Link2, label: 'Link', action: () => { const url = prompt('Link address'); if (url) run('createLink', url) } },
    { icon: List, label: 'Bulleted list', action: () => run('insertUnorderedList') },
    { icon: ListOrdered, label: 'Numbered list', action: () => run('insertOrderedList') },
    { icon: Quote, label: 'Quote', action: () => run('formatBlock', 'blockquote') },
    { icon: ImagePlus, label: 'Insert image', action: () => picker.current?.click() },
  ]
  return (
    <div role="toolbar" aria-label="Formatting" className="flex items-center gap-0.5">
      <select
        aria-label="Font"
        defaultValue=""
        onFocus={saveSelection}
        onChange={(e) => { restoreSelection(); run('styleWithCSS', 'true'); run('fontName', e.target.value); e.target.value = '' }}
        className="mr-1 rounded-md bg-transparent px-1.5 py-1 text-[12.5px] hover:bg-raise hover:text-ink"
      >
        <option value="" disabled>Font</option>
        {fonts.map((font) => <option key={font.label} value={font.value} style={{ fontFamily: font.value }}>{font.label}</option>)}
      </select>
      {tools.map(({ icon: Icon, label, action }) => (
        // preventDefault on mousedown keeps the text selection in the editor.
        <button key={label} type="button" title={label} aria-label={label} onMouseDown={(e) => e.preventDefault()} onClick={action} className="rounded-md p-1.5 hover:bg-raise hover:text-ink">
          <Icon size={15} />
        </button>
      ))}
      <input ref={picker} type="file" accept="image/*" multiple hidden onChange={(e) => { insertImages(e.target.files ?? []); e.target.value = '' }} />
    </div>
  )
}

function RichEditor({ content, version, onChange }: { content: string; version: number; onChange: (html: string) => void }) {
  const editor = useRef<HTMLDivElement>(null)

  // Load content only when the composer replaces it; otherwise the browser owns the DOM while typing.
  useEffect(() => {
    if (editor.current) editor.current.innerHTML = content
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version])

  function onPaste(event: ClipboardEvent<HTMLDivElement>) {
    const images = Array.from(event.clipboardData.files).filter((f) => f.type.startsWith('image/'))
    if (images.length) { event.preventDefault(); insertImages(images) }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    const images = Array.from(event.dataTransfer.files).filter((f) => f.type.startsWith('image/'))
    if (images.length) { event.preventDefault(); insertImages(images) }
  }

  return (
    <div
      ref={editor}
      contentEditable
      spellCheck
      lang="en"
      role="textbox"
      aria-multiline="true"
      aria-label="Message body"
      data-placeholder="Write your message…"
      onInput={(e) => onChange(e.currentTarget.innerHTML)}
      onPaste={onPaste}
      onDrop={onDrop}
      className="flex-1 overflow-y-auto px-4 py-3 text-[15px] leading-relaxed empty:before:text-muted empty:before:content-[attr(data-placeholder)] [&_a]:text-accent-text [&_a]:underline [&_blockquote]:mt-3 [&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-3 [&_blockquote]:text-muted [&_img]:my-2 [&_img]:max-w-full [&_img]:rounded-lg [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6 [&_[data-signature]]:mt-4 [&_[data-signature]]:text-muted"
    />
  )
}

function SourceEditor({ content, onChange }: { content: string; onChange: (html: string) => void }) {
  const preview = useMemo(() => buildSafeEmailDocument(content, true).html, [content])
  return (
    <div className="grid min-h-0 flex-1 grid-rows-2 md:grid-cols-2 md:grid-rows-1">
      <textarea
        value={content}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        aria-label="HTML source"
        placeholder="<p>Paste or write HTML…</p>"
        className="resize-none border-b border-line bg-ground px-4 py-3 font-mono text-[12.5px] leading-relaxed text-ink-2 placeholder:text-muted focus:outline-none md:border-r md:border-b-0"
      />
      {/* Same sandbox and sanitizer as received mail, so the preview shows what recipients will get. */}
      <iframe title="HTML preview" sandbox="" srcDoc={preview} className="h-full w-full bg-white" />
    </div>
  )
}
