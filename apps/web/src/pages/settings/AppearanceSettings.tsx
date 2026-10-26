// Settings → Appearance: light, dark or system theme, and the three-pane or list layout.
import { Columns2, Monitor, Moon, Rows3, Sun } from 'lucide-react'
import { Card } from '../../components/ui'
import { useStore, type Layout, type Theme } from '../../lib/store'

function Choice<T extends string>({
  value,
  current,
  onPick,
  icon: Icon,
  title,
  detail,
}: {
  value: T
  current: T
  onPick: (v: T) => void
  icon: typeof Sun
  title: string
  detail: string
}) {
  return (
    <button
      type="button"
      aria-pressed={current === value}
      onClick={() => onPick(value)}
      className={`grid justify-items-start gap-1 rounded-xl border p-3.5 text-left ${current === value ? 'border-accent bg-sel' : 'border-line bg-raise hover:bg-hover'}`}
    >
      <Icon size={18} className="text-muted" />
      <span className="font-semibold">{title}</span>
      <span className="text-[12.5px] text-muted">{detail}</span>
    </button>
  )
}

export function AppearanceSettings() {
  const { theme, setTheme, layout, setLayout } = useStore()
  return (
    <>
      <Card title="Theme">
        <div className="grid gap-2 sm:grid-cols-3">
          <Choice<Theme>
            value="system"
            current={theme}
            onPick={setTheme}
            icon={Monitor}
            title="System"
            detail="Follow your device"
          />
          <Choice<Theme>
            value="dark"
            current={theme}
            onPick={setTheme}
            icon={Moon}
            title="Dark"
            detail="Easy on the eyes at night"
          />
          <Choice<Theme>
            value="light"
            current={theme}
            onPick={setTheme}
            icon={Sun}
            title="Light"
            detail="Bright rooms, daylight"
          />
        </div>
      </Card>
      <Card title="Layout" description="On phones, Nexus always shows one pane at a time.">
        <div className="grid gap-2 sm:grid-cols-2">
          <Choice<Layout>
            value="three-pane"
            current={layout}
            onPick={setLayout}
            icon={Columns2}
            title="Three panes"
            detail="List and message side by side"
          />
          <Choice<Layout>
            value="list"
            current={layout}
            onPick={setLayout}
            icon={Rows3}
            title="List, then message"
            detail="Opening a message replaces the list"
          />
        </div>
      </Card>
    </>
  )
}
