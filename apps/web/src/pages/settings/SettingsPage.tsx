// The settings screen: the list of sections on the left, the chosen section on the right.
import {
  ArrowLeft,
  ArrowRightLeft,
  AtSign,
  Filter,
  Gauge,
  KeyRound,
  Menu,
  Palette,
  Puzzle,
  Rss,
  Shield,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { Link, useOutletContext, useParams } from 'react-router'
import type { ShellContext } from '../../components/AppShell'
import { useMe } from '../../lib/queries'
import { AccountsSettings } from './AccountsSettings'
import { AdminSettings } from './AdminSettings'
import { AppearanceSettings } from './AppearanceSettings'
import { EncryptionSettings } from './EncryptionSettings'
import { FeedsSettings } from './FeedsSettings'
import { ImportExportSettings } from './ImportExportSettings'
import { PluginsSettings } from './PluginsSettings'
import { RulesSettings } from './RulesSettings'
import { SecuritySettings } from './SecuritySettings'
import { SharingSettings } from './SharingSettings'

const allSections: { id: string; title: string; icon: LucideIcon; page: () => React.ReactNode; adminOnly?: boolean }[] =
  [
    { id: 'accounts', title: 'Mail accounts', icon: AtSign, page: AccountsSettings },
    { id: 'sharing', title: 'Sharing', icon: Users, page: SharingSettings },
    { id: 'security', title: 'Password & 2FA', icon: Shield, page: SecuritySettings },
    { id: 'encryption', title: 'PGP & S/MIME', icon: KeyRound, page: EncryptionSettings },
    { id: 'feeds', title: 'Feeds', icon: Rss, page: FeedsSettings },
    { id: 'rules', title: 'Rules & spam', icon: Filter, page: RulesSettings },
    { id: 'plugins', title: 'Plugins', icon: Puzzle, page: PluginsSettings },
    { id: 'import-export', title: 'Import & export', icon: ArrowRightLeft, page: ImportExportSettings },
    { id: 'appearance', title: 'Appearance', icon: Palette, page: AppearanceSettings },
    { id: 'admin', title: 'Admin', icon: Gauge, page: AdminSettings, adminOnly: true },
  ]

export function SettingsPage() {
  const { section } = useParams()
  const { openNav } = useOutletContext<ShellContext>()
  const isAdmin = useMe().data?.role === 'admin'
  const sections = allSections.filter((s) => isAdmin || !s.adminOnly)
  const current = sections.find((s) => s.id === section)
  // Desktop opens on the first section; phone shows the section list first.
  const shown = current ?? sections[0]
  const Page = shown.page

  return (
    <div className="flex h-full">
      <nav
        aria-label="Settings"
        className={`h-full flex-col gap-0.5 border-r border-line bg-panel p-2.5 lg:flex lg:w-[240px] lg:shrink-0 ${current ? 'hidden' : 'flex w-full'}`}
      >
        <div className="flex items-center gap-2 px-1.5 pt-1 pb-3">
          <button
            type="button"
            aria-label="Open menu"
            onClick={openNav}
            className="rounded-md p-1 text-muted hover:bg-raise md:hidden"
          >
            <Menu size={18} />
          </button>
          <h1 className="text-[19px] font-bold tracking-tight">Settings</h1>
        </div>
        {sections.map(({ id, title, icon: Icon }) => (
          <Link
            key={id}
            to={`/settings/${id}`}
            aria-current={shown.id === id ? 'page' : undefined}
            className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 ${shown.id === id ? 'lg:bg-raise lg:font-semibold' : ''} hover:bg-hover`}
          >
            <Icon size={16} strokeWidth={1.8} className="text-muted" />
            {title}
          </Link>
        ))}
      </nav>

      <div className={`h-full min-w-0 flex-1 overflow-y-auto bg-read ${current ? '' : 'hidden lg:block'}`}>
        <div className="mx-auto grid max-w-[760px] gap-5 px-4 py-6 md:px-10 md:py-8">
          <Link to="/settings" className="flex items-center gap-1.5 text-muted lg:hidden">
            <ArrowLeft size={16} /> Settings
          </Link>
          <h2 className="text-[23px] font-bold tracking-tight">{shown.title}</h2>
          <Page />
        </div>
      </div>
    </div>
  )
}
