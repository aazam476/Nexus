// The plugin API. A plugin is one object that says what it is, which settings it needs,
// and implements one or more capabilities. See docs/plugins.md for a walkthrough.
//
// Security note for plugin authors and admins: plugins run inside the Nexus server process with
// full access. Only install plugins you trust, the same as any other server software.
import { errorMessage } from '../lib/http.ts'

export interface PluginSetting {
  key: string
  label: string
  type: 'text' | 'password' | 'url'
  placeholder?: string
  required?: boolean
}

export interface PluginFile {
  filename: string
  contentType: string
  content: Buffer
}

export interface PluginEvent {
  title: string
  start: string // ISO date-time
  end: string
  location?: string
  detail?: string
}

// What a plugin receives on every call: the user's saved settings for it.
export type PluginSettings = Record<string, string>

export interface NexusPlugin {
  id: string // lowercase, unique, e.g. "immich"
  name: string
  description: string
  author: string
  settings: PluginSetting[]

  // Capabilities. Implement the ones that make sense; the UI shows only what a plugin can do.
  saveAttachment?: (file: PluginFile, settings: PluginSettings) => Promise<{ url?: string }>
  createEvent?: (event: PluginEvent, settings: PluginSettings) => Promise<{ url?: string }>

  // Optional: called by "Test connection" in Settings. Throw an Error with a helpful message on failure.
  testConnection?: (settings: PluginSettings) => Promise<void>
}

// Shared by the built-in plugins: a fetch that turns HTTP errors into readable messages.
export async function request(url: string, init: RequestInit, service: string): Promise<Response> {
  let response: Response
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) })
  } catch (error) {
    throw new Error(`Could not reach ${service} at ${new URL(url).origin}: ${errorMessage(error)}`)
  }
  if (response.status === 401 || response.status === 403) throw new Error(`${service} rejected the credentials`)
  if (!response.ok) throw new Error(`${service} answered ${response.status}: ${(await response.text()).slice(0, 200)}`)
  return response
}

export const trimUrl = (url: string) => url.replace(/\/+$/, '')
