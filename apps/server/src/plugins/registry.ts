// Knows every plugin: the built-in ones plus any found in PLUGINS_DIR at startup.
// A third-party plugin is a folder (or single .js/.mjs file) whose default export is a NexusPlugin.
import type { Dirent } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { immich } from './immich.ts'
import { nextcloudCalendar, nextcloudFiles } from './nextcloud.ts'
import { paperless } from './paperless.ts'
import type { NexusPlugin } from './types.ts'

const plugins = new Map<string, NexusPlugin & { builtIn: boolean }>()

for (const plugin of [immich, nextcloudFiles, nextcloudCalendar, paperless]) plugins.set(plugin.id, { ...plugin, builtIn: true })

export async function loadExternalPlugins(dir: string) {
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return // no plugins folder: nothing to load
  }
  // A folder with index.js, or a single .js/.mjs file. Anything else (like a README) is ignored.
  const candidates = entries.filter((e) => !e.name.startsWith('.') && (e.isDirectory() || /\.m?js$/.test(e.name)))
  for (const { name: entry } of candidates) {
    const path = resolve(dir, entry)
    const file = /\.m?js$/.test(entry) ? path : join(path, 'index.js')
    try {
      const plugin = (await import(pathToFileURL(file).href)).default as NexusPlugin
      if (!plugin?.id || !plugin.name || !Array.isArray(plugin.settings)) throw new Error('default export is not a Nexus plugin')
      if (plugins.has(plugin.id)) throw new Error(`a plugin with id "${plugin.id}" is already loaded`)
      plugins.set(plugin.id, { ...plugin, builtIn: false })
      console.info(`Loaded plugin ${plugin.name} (${plugin.id}) from ${entry}`)
    } catch (error) {
      console.warn(`Skipped plugin ${entry}: ${(error as Error).message}`)
    }
  }
}

export const allPlugins = () => [...plugins.values()]
export const getPlugin = (id: string) => plugins.get(id)

export function capabilities(plugin: NexusPlugin) {
  return [plugin.saveAttachment && 'save-attachment', plugin.createEvent && 'create-event'].filter(Boolean) as string[]
}
