// The frame around every signed-in page: sidebar, the page itself, the composer and app-wide shortcuts.
// Sends you to the sign-in page when your session has ended.
import { useEffect, useState } from 'react'
import { Navigate, Outlet, useNavigate } from 'react-router'
import { ApiError } from '../lib/api'
import { isTyping } from '../lib/keyboard'
import { useMe } from '../lib/queries'
import { useStore } from '../lib/store'
import { Composer } from './Composer'
import { SentNotice } from './SentNotice'
import { ShortcutsHelp } from './ShortcutsHelp'
import { Sidebar } from './Sidebar'
import { Logo } from './ui'

// Pages read this with useOutletContext() to open the mobile sidebar.
export interface ShellContext {
  openNav: () => void
}

export function AppShell() {
  const me = useMe()
  const { draft, openComposer, applyPreferences } = useStore()
  const navigate = useNavigate()
  const [navOpen, setNavOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)

  // Use the theme and layout saved on the server, so they follow the user between devices.
  useEffect(() => {
    if (me.data) applyPreferences(me.data.preferences)
  }, [me.data?.id])

  // Shortcuts that work everywhere. Mail-specific keys live in MailPage.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (isTyping(event)) return
      if (event.key === 'c') {
        event.preventDefault()
        openComposer()
      }
      if (event.key === '?') setHelpOpen((open) => !open)
      if (event.key === 'Escape') {
        setHelpOpen(false)
        setNavOpen(false)
      }
      if (event.key === ',') navigate('/settings')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openComposer, navigate])

  if (me.error instanceof ApiError && me.error.status === 401) return <Navigate to="/login" replace />
  if (!me.data) {
    return (
      <div className="grid h-full place-items-center" aria-busy="true">
        {me.error ? (
          <p className="text-danger">Can’t reach the Nexus server. {me.error.message}</p>
        ) : (
          <Logo size={40} />
        )}
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden">
      <aside className="hidden w-[228px] shrink-0 border-r border-line md:block">
        <Sidebar onShowShortcuts={() => setHelpOpen(true)} />
      </aside>

      {navOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Mailboxes">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-black/50"
            onClick={() => setNavOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-[280px] border-r border-line shadow-pop">
            <Sidebar
              onNavigate={() => setNavOpen(false)}
              onShowShortcuts={() => {
                setNavOpen(false)
                setHelpOpen(true)
              }}
            />
          </aside>
        </div>
      )}

      <main className="min-w-0 flex-1">
        <Outlet context={{ openNav: () => setNavOpen(true) } satisfies ShellContext} />
      </main>

      {draft && <Composer key={draft.id ?? 'new'} />}
      <SentNotice />
      {helpOpen && <ShortcutsHelp onClose={() => setHelpOpen(false)} />}
    </div>
  )
}
