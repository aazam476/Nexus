// Data hooks: one place that knows which API path returns what.
// Components call these instead of fetching directly, so caching and refreshing stay consistent.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { Account, Contact, Feed, FeedItem, FolderRole, Message, Plugin, Rule } from '../types'
import { api } from './api'

export interface Me {
  id: string
  name: string
  email: string
  role: 'admin' | 'user'
  totpEnabled: boolean
  privateStorage: boolean
  recoveryCodesLeft: number
  preferences: {
    theme: 'system' | 'dark' | 'light'
    layout: 'three-pane' | 'list'
    spamThreshold: number
    feedRetentionDays: number | null // delete feed posts older than this; null keeps them all
    undoSendSeconds: number // how long a sent message waits so it can be taken back; 0 = off
  }
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

export const useMe = () =>
  useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/auth/me'), retry: false, staleTime: 5 * 60_000 })
export const useAccounts = () => useQuery({ queryKey: ['accounts'], queryFn: () => api<Account[]>('/accounts') })
export const useCounts = () => useQuery({ queryKey: ['counts'], queryFn: () => api<Counts>('/counts'), ...live })
export const useLabels = () =>
  useQuery({ queryKey: ['labels'], queryFn: () => api<{ name: string; color: string }[]>('/labels') })

export const useMessages = (q: MessageQuery) =>
  useQuery({
    queryKey: ['messages', q],
    queryFn: () => api<Message[]>(`/messages${query({ ...q, limit: q.limit ? String(q.limit) : undefined })}`),
    ...live,
    placeholderData: (previous) => previous,
  })

export const useMessage = (id: string | undefined) =>
  useQuery({ queryKey: ['message', id], queryFn: () => api<Message>(`/messages/${id}`), enabled: !!id })

export const useContacts = (q = '') =>
  useQuery({ queryKey: ['contacts', q], queryFn: () => api<Contact[]>(`/contacts${query({ q })}`) })
export const usePlugins = () => useQuery({ queryKey: ['plugins'], queryFn: () => api<Plugin[]>('/plugins') })
export const useRules = () => useQuery({ queryKey: ['rules'], queryFn: () => api<Rule[]>('/rules') })
// Feeds refresh on the server every half hour; re-checking the lists every minute picks that up.
export const useFeeds = () => useQuery({ queryKey: ['feeds'], queryFn: () => api<Feed[]>('/feeds'), ...live })
// Which posts to list: everything, only starred, or one feed's; optionally matching search words.
export interface FeedItemQuery {
  show: 'all' | 'starred' | string // a feed id, for one feed
  q?: string
}
export const useFeedItems = ({ show, q }: FeedItemQuery) => {
  const params = {
    starred: show === 'starred' ? 'true' : undefined,
    feed: show !== 'all' && show !== 'starred' ? show : undefined,
    q: q || undefined,
  }
  return useQuery({
    queryKey: ['feed-items', params],
    queryFn: () => api<FeedItem[]>(`/feed-items${query(params)}`),
    ...live,
    placeholderData: (previous) => previous, // keep the old list on screen while a search loads
  })
}
export const useFeedItem = (id: string | undefined) =>
  useQuery({ queryKey: ['feed-item', id], queryFn: () => api<FeedItem>(`/feed-items/${id}`), enabled: !!id })
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

// The refresh button: ask every mail server for new mail now, instead of waiting for the next
// automatic sync. Syncing runs in the background with no "done" signal, so watch each account's
// last-sync time until every one has changed (or 20 seconds pass, for a server that's down).
export function useCheckForMail() {
  const client = useQueryClient()
  const refreshMail = useRefreshMail()
  const [checking, setChecking] = useState(false)

  async function check() {
    setChecking(true)
    try {
      const before = await api<Account[]>('/accounts')
      await Promise.all(before.map((account) => api(`/accounts/${account.id}/sync`, { body: {} })))
      const synced = (now: Account[]) =>
        now.every((account) => account.lastSyncAt !== before.find((b) => b.id === account.id)?.lastSyncAt)
      for (let waited = 0; waited < 20_000; waited += 1_000) {
        await new Promise((resolve) => setTimeout(resolve, 1_000))
        if (synced(await api<Account[]>('/accounts'))) break
      }
    } finally {
      client.invalidateQueries({ queryKey: ['accounts'] })
      refreshMail()
      setChecking(false)
    }
  }
  return { check, checking }
}

// What this server allows: whether it still needs its first admin, sign-up, and which provider sign-ins are set up.
export const useServerStatus = () =>
  useQuery({
    queryKey: ['auth-status'],
    queryFn: () =>
      api<{ needsSetup: boolean; allowSignup: boolean; oauth: { google: boolean; microsoft: boolean } }>(
        '/auth/status',
      ),
  })
