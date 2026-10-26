// UI state shared across the app: theme, layout and the open composer.
// Mail itself comes from the server through the hooks in queries.ts.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Message } from '../types'
import { put } from './api'

export type Theme = 'system' | 'dark' | 'light'
export type Layout = 'three-pane' | 'list'

export interface Draft {
  id?: string // set when editing a saved draft
  accountId?: string
  to: string
  cc: string
  bcc: string
  subject: string
  html?: string
  replyTo?: Message
  forwardOf?: string // id of the message whose attachments go along
}

interface Store {
  theme: Theme
  setTheme: (theme: Theme) => void
  layout: Layout
  setLayout: (layout: Layout) => void
  applyPreferences: (preferences: { theme: Theme; layout: Layout }) => void
  draft: Draft | null
  openComposer: (draft?: Partial<Draft>) => void
  closeComposer: () => void
}

const StoreContext = createContext<Store | null>(null)

// The theme is also kept in localStorage so the first paint is right before the server answers.
function readLocal<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T) ?? fallback
  } catch {
    return fallback
  }
}

function saveLocal(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Private mode or blocked storage: the server copy still has it.
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => readLocal('nexus.theme', 'system'))
  const [layout, setLayoutState] = useState<Layout>(() => readLocal('nexus.layout', 'three-pane'))
  const [draft, setDraft] = useState<Draft | null>(null)

  // Apply the theme to the page (styles.css picks colours by the html element's data-theme).
  // "system" follows the device's light/dark setting, and keeps following it if it changes.
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: light)')
    const apply = () => {
      const resolved = theme === 'system' ? (media.matches ? 'light' : 'dark') : theme
      document.documentElement.dataset.theme = resolved
      document
        .querySelector('meta[name=theme-color]')
        ?.setAttribute('content', resolved === 'light' ? '#F3F3F6' : '#0E0F12')
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])

  // Theme and layout are saved twice: in this browser (so the page looks right at once, before the
  // server answers) and on the server (so they follow you to your other devices).
  const store: Store = {
    theme,
    setTheme: (value) => {
      setThemeState(value)
      saveLocal('nexus.theme', value)
      put('/auth/me/preferences', { theme: value }).catch(() => undefined)
    },
    layout,
    setLayout: (value) => {
      setLayoutState(value)
      saveLocal('nexus.layout', value)
      put('/auth/me/preferences', { layout: value }).catch(() => undefined)
    },
    applyPreferences: (preferences) => {
      setThemeState(preferences.theme)
      setLayoutState(preferences.layout)
      saveLocal('nexus.theme', preferences.theme)
      saveLocal('nexus.layout', preferences.layout)
    },
    draft,
    openComposer: (partial) => setDraft({ to: '', cc: '', bcc: '', subject: '', ...partial }),
    closeComposer: () => setDraft(null),
  }

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
}

export function useStore(): Store {
  const store = useContext(StoreContext)
  if (!store) throw new Error('useStore must be used inside <StoreProvider>')
  return store
}
