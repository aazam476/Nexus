// Data hooks: one place that knows which API path returns what.
// Components call these instead of fetching directly, so caching and refreshing stay consistent.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Account, Contact, FolderRole, Message, Plugin, Rule } from '../types'
import { api } from './api'

export interface Me {
  id: string
  name: string
  email: string
  role: 'admin' | 'user'
  totpEnabled: boolean
  privateStorage: boolean
  recoveryCodesLeft: number
  preferences: { theme: 'system' | 'dark' | 'light'; layout: 'three-pane' | 'list'; spamThreshold: number }
}

export interface Counts {
  folders: Partial<Record<FolderRole, number>>
  accounts: Record<string, number>
  labels: Record<string, number>
}

export interface MessageQuery {
  folder: string
  account?: string | null
  label?: string | null
  q?: string
  limit?: number
}

const query = (params: Record<string, string | null | undefined>) => {
  const search = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][])
  return search.size ? `?${search}` : ''
}

// Mail changes in the background (sync runs every 2 minutes), so lists refresh on their own.
const live = { refetchInterval: 60_000, refetchOnWindowFocus: true }

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/auth/me'), retry: false, staleTime: 5 * 60_000 })
export const useAccounts = () => useQuery({ queryKey: ['accounts'], queryFn: () => api<Account[]>('/accounts') })
export const useCounts = () => useQuery({ queryKey: ['counts'], queryFn: () => api<Counts>('/counts'), ...live })
export const useLabels = () => useQuery({ queryKey: ['labels'], queryFn: () => api<{ name: string; color: string }[]>('/labels') })

export const useMessages = (q: MessageQuery) =>
  useQuery({ queryKey: ['messages', q], queryFn: () => api<Message[]>(`/messages${query({ ...q, limit: q.limit ? String(q.limit) : undefined })}`), ...live, placeholderData: (previous) => previous })

export const useMessage = (id: string | undefined) =>
  useQuery({ queryKey: ['message', id], queryFn: () => api<Message>(`/messages/${id}`), enabled: !!id })

export const useContacts = (q = '') => useQuery({ queryKey: ['contacts', q], queryFn: () => api<Contact[]>(`/contacts${query({ q })}`) })
export const usePlugins = () => useQuery({ queryKey: ['plugins'], queryFn: () => api<Plugin[]>('/plugins') })
export const useRules = () => useQuery({ queryKey: ['rules'], queryFn: () => api<Rule[]>('/rules') })
export const useBlocked = () => useQuery({ queryKey: ['blocked'], queryFn: () => api<string[]>('/blocked') })

// After any change to mail, refresh everything that shows mail.
export function useRefreshMail() {
  const client = useQueryClient()
  return () => {
    client.invalidateQueries({ queryKey: ['messages'] })
    client.invalidateQueries({ queryKey: ['message'] })
    client.invalidateQueries({ queryKey: ['counts'] })
  }
}
