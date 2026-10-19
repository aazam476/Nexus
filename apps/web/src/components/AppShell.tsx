import { useEffect, useState } from 'react'
import { Outlet, useNavigate } from 'react-router'
import { useStore } from '../lib/store'
import { isTyping } from '../lib/keyboard'
import { Composer } from './Composer'
import { ShortcutsHelp } from './ShortcutsHelp'
import { Sidebar } from './Sidebar'

// Pages read this with useOutletContext() to open the mobile sidebar.
export interface ShellContext {
  openNav: () => void
}

export function AppShell() {
  const { draft, openComposer } = useStore()
  const navigate = useNavigate()
  const [navOpen, setNavOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)

  // Shortcuts that work everywhere. Mail-specific keys live in MailPage.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (isTyping(event)) return
      if (event.key === 'c') { event.preventDefault(); openComposer() }
      if (event.key === '?') setHelpOpen((open) => !open)
      if (event.key === 'Escape') { setHelpOpen(false); setNavOpen(false) }
      if (event.key === ',') navigate('/settings')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openComposer, navigate])

  return (
    <div className="flex h-full overflow-hidden">
      <aside className="hidden w-[228px] shrink-0 border-r border-line md:block">
        <Sidebar />
      </aside>

      {navOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Mailboxes">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-black/50" onClick={() => setNavOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-[280px] border-r border-line shadow-pop">
            <Sidebar onNavigate={() => setNavOpen(false)} />
          </aside>
        </div>
      )}

      <main className="min-w-0 flex-1">
        <Outlet context={{ openNav: () => setNavOpen(true) } satisfies ShellContext} />
      </main>

      {draft && <Composer />}
      {helpOpen && <ShortcutsHelp onClose={() => setHelpOpen(false)} />}
    </div>
  )
}
