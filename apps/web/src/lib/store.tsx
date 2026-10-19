// App-wide state: messages, theme, layout and the composer.
// shortcut: state lives in memory on mock data; swap for API calls + react-query when the server lands.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { messages as mockMessages } from '../mock/data'
import type { Message } from '../types'

export type Theme = 'system' | 'dark' | 'light'
export type Layout = 'three-pane' | 'list'

export interface Draft {
  to: string
  cc: string
  bcc: string
  subject: string
  body: string
  replyTo?: Message
}

interface Store {
  messages: Message[]
  updateMessage: (id: string, change: Partial<Message>) => void
  theme: Theme
  setTheme: (theme: Theme) => void
  layout: Layout
  setLayout: (layout: Layout) => void
  draft: Draft | null
  openComposer: (draft?: Partial<Draft>) => void
  closeComposer: () => void
}

const StoreContext = createContext<Store | null>(null)

function readSetting<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T) ?? fallback
  } catch {
    return fallback
  }
}

function saveSetting(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Private mode or blocked storage: the setting just won't persist.
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState(mockMessages)
  const [theme, setThemeState] = useState<Theme>(() => readSetting('nexus.theme', 'system'))
  const [layout, setLayoutState] = useState<Layout>(() => readSetting('nexus.layout', 'three-pane'))
  const [draft, setDraft] = useState<Draft | null>(null)

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: light)')
    const apply = () => {
      const resolved = theme === 'system' ? (media.matches ? 'light' : 'dark') : theme
      document.documentElement.dataset.theme = resolved
      document.querySelector('meta[name=theme-color]')?.setAttribute('content', resolved === 'light' ? '#F3F3F6' : '#0E0F12')
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])

  const store: Store = {
    messages,
    updateMessage: (id, change) => setMessages((all) => all.map((m) => (m.id === id ? { ...m, ...change } : m))),
    theme,
    setTheme: (value) => {
      setThemeState(value)
      saveSetting('nexus.theme', value)
    },
    layout,
    setLayout: (value) => {
      setLayoutState(value)
      saveSetting('nexus.layout', value)
    },
    draft,
    openComposer: (partial) => setDraft({ to: '', cc: '', bcc: '', subject: '', body: '', ...partial }),
    closeComposer: () => setDraft(null),
  }

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
}

export function useStore(): Store {
  const store = useContext(StoreContext)
  if (!store) throw new Error('useStore must be used inside <StoreProvider>')
  return store
}
