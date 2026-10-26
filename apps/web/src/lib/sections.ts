// The smart inbox's sections, in the order they're shown. The server decides which section each
// message belongs to (see server/features/mail/sorting.ts). Machine mail is "bundled": collapsed
// into one row until you open it.
import type { Category } from '../types'

export const sections: { category: Category; title: string; color: string; bundled: boolean }[] = [
  { category: 'people', title: 'People', color: 'var(--people)', bundled: false },
  { category: 'travel', title: 'Travel', color: 'var(--travel)', bundled: false },
  { category: 'notifications', title: 'Notifications', color: 'var(--notif)', bundled: true },
  { category: 'newsletters', title: 'Newsletters', color: 'var(--news)', bundled: true },
]
