import { CalendarPlus, CloudUpload, ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { Button, Card, Chip, Field, Input, Toggle } from '../../components/ui'
import { plugins as initialPlugins } from '../../mock/data'

const capabilityLabels = {
  'save-attachment': { text: 'Saves attachments', icon: CloudUpload },
  'create-event': { text: 'Creates calendar events', icon: CalendarPlus },
}

export function PluginsSettings() {
  const [plugins, setPlugins] = useState(initialPlugins)
  const [open, setOpen] = useState<string | null>(null)

  return (
    <>
      <p className="text-muted">
        Plugins connect Nexus to the rest of your server. Built-in plugins ship with Nexus; anyone can write one and drop it in the <code className="rounded bg-raise px-1 py-0.5 text-[12.5px]">plugins/</code> folder.
      </p>
      {plugins.map((plugin) => (
        <Card
          key={plugin.id}
          title={plugin.name}
          description={plugin.description}
          actions={<Toggle checked={plugin.enabled} label={`Enable ${plugin.name}`} onChange={(enabled) => setPlugins(plugins.map((p) => (p.id === plugin.id ? { ...p, enabled } : p)))} />}
        >
          <div className="flex flex-wrap items-center gap-2">
            {plugin.capabilities.map((c) => {
              const { text, icon: Icon } = capabilityLabels[c]
              return <Chip key={c} color="var(--muted)"><Icon size={12} /> {text}</Chip>
            })}
            {plugin.builtIn && <Chip color="var(--muted)">Built in</Chip>}
            <Button variant="ghost" className="ml-auto" onClick={() => setOpen(open === plugin.id ? null : plugin.id)} aria-expanded={open === plugin.id}>
              {open === plugin.id ? 'Close' : 'Configure'}
            </Button>
          </div>
          {open === plugin.id && (
            <form className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); setOpen(null) }}>
              {plugin.settings.map((s) => (
                <Field key={s.key} label={s.label}>
                  <Input type={s.type === 'password' ? 'password' : 'text'} defaultValue={s.value} placeholder={s.placeholder} autoComplete="off" />
                </Field>
              ))}
              <div className="flex gap-2 sm:col-span-2">
                <Button type="submit" variant="primary">Save</Button>
                <Button>Test connection</Button>
              </div>
            </form>
          )}
        </Card>
      ))}
      <a href="https://github.com/aliazam/nexus/blob/main/docs/plugins.md" target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-accent-text hover:underline">
        Write your own plugin <ExternalLink size={13} />
      </a>
    </>
  )
}
