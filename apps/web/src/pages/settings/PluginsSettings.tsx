// Settings → Plugins: turn plugins on, fill in their settings, and test the connection.
import { useQueryClient } from '@tanstack/react-query'
import { CalendarPlus, CloudUpload } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Button, Card, Chip, Field, Input, Toggle } from '../../components/ui'
import { api, put } from '../../lib/api'
import { usePlugins } from '../../lib/queries'
import type { Plugin } from '../../types'

const capabilityLabels = {
  'save-attachment': { text: 'Saves attachments', icon: CloudUpload },
  'create-event': { text: 'Creates calendar events', icon: CalendarPlus },
}

export function PluginsSettings() {
  const plugins = usePlugins().data ?? []
  return (
    <>
      <p className="text-muted">
        Plugins connect Nexus to the rest of your server. Built-in ones ship with Nexus; anyone can write one and drop it in the <code className="rounded bg-raise px-1 py-0.5 text-[12.5px]">plugins/</code> folder (see docs/plugins.md).
      </p>
      {plugins.map((plugin) => <PluginCard key={plugin.id} plugin={plugin} />)}
    </>
  )
}

function PluginCard({ plugin }: { plugin: Plugin }) {
  const client = useQueryClient()
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const refresh = () => client.invalidateQueries({ queryKey: ['plugins'] })

  async function toggle(enabled: boolean) {
    try {
      await put(`/plugins/${plugin.id}`, { enabled })
      setMessage(null)
      refresh()
    } catch (e) {
      setOpen(true)
      setMessage({ ok: false, text: (e as Error).message })
    }
  }

  const saveForm = (form: HTMLFormElement) => put(`/plugins/${plugin.id}`, { settings: Object.fromEntries(new FormData(form)) })

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      await saveForm(event.currentTarget)
      setMessage({ ok: true, text: 'Saved' })
      refresh()
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message })
    }
  }

  // Tests what is typed in the form, so it is saved first: the server tests the saved settings.
  async function test(form: HTMLFormElement) {
    setMessage({ ok: true, text: 'Testing…' })
    try {
      await saveForm(form)
      refresh()
      await api(`/plugins/${plugin.id}/test`, { body: {} })
      setMessage({ ok: true, text: 'Connected' })
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message })
    }
  }

  return (
    <Card title={plugin.name} description={plugin.description} actions={<Toggle checked={plugin.enabled} label={`Turn ${plugin.name} on`} onChange={toggle} />}>
      <div className="flex flex-wrap items-center gap-2">
        {plugin.capabilities.map((c) => {
          const { text, icon: Icon } = capabilityLabels[c]
          return <Chip key={c} color="var(--muted)"><Icon size={12} /> {text}</Chip>
        })}
        <Chip color="var(--muted)">{plugin.builtIn ? 'Built in' : `By ${plugin.author}`}</Chip>
        <Button variant="ghost" className="ml-auto" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Close' : 'Configure'}</Button>
      </div>
      {open && (
        <form className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-2" onSubmit={save}>
          {plugin.settings.map((s) => (
            <Field key={s.key} label={s.label + (s.required ? '' : ' (optional)')}>
              <Input name={s.key} type={s.type === 'password' ? 'password' : s.type === 'url' ? 'url' : 'text'} defaultValue={s.value} placeholder={s.placeholder} autoComplete="off" />
            </Field>
          ))}
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <Button type="submit" variant="primary">Save</Button>
            <Button onClick={(e) => test(e.currentTarget.form!)}>Test connection</Button>
            {message && <span role={message.ok ? 'status' : 'alert'} className={`text-[13px] ${message.ok ? 'text-news' : 'text-danger'}`}>{message.text}</span>}
          </div>
        </form>
      )}
      {!open && message && !message.ok && <p role="alert" className="mt-3 text-[13px] text-danger">{message.text}</p>}
    </Card>
  )
}
