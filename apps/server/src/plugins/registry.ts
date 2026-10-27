// Knows every plugin: the built-in ones, any found in PLUGINS_DIR at startup, and any an admin
// uploads while Nexus runs (saved into PLUGINS_DIR too, so they load again after a restart).
// A third-party plugin is a folder (or single .js/.mjs file) whose default export is a NexusPlugin.
import { createHash } from 'node:crypto'
import type { Dirent } from 'node:fs'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { immich } from './immich.ts'
import { nextcloudCalendar, nextcloudFiles } from './nextcloud.ts'
import { paperless } from './paperless.ts'
import type { NexusPlugin } from './types.ts'

// `source` is where a third-party plugin's code lives (its file or folder), so it can be removed.
const plugins = new Map<string, NexusPlugin & { builtIn: boolean; source?: string }>()

for (const plugin of [immich, nextcloudFiles, nextcloudCalendar, paperless])
  plugins.set(plugin.id, { ...plugin, builtIn: true })

// Runs the plugin's code and adds it to the list. Throws if it isn't a usable plugin.
async function loadPlugin(file: string, source: string): Promise<NexusPlugin> {
  const plugin = (await import(pathToFileURL(file).href)).default as NexusPlugin
  if (!plugin?.id || !plugin.name || !Array.isArray(plugin.settings))
    throw new Error('default export is not a Nexus plugin')
  if (plugins.has(plugin.id)) throw new Error(`a plugin with id "${plugin.id}" is already installed`)
  plugins.set(plugin.id, { ...plugin, builtIn: false, source })
  return plugin
}

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
      const plugin = await loadPlugin(file, path)
      console.info(`Loaded plugin ${plugin.name} (${plugin.id}) from ${entry}`)
    } catch (error) {
      console.warn(`Skipped plugin ${entry}: ${(error as Error).message}`)
    }
  }
}

// An admin's upload: saved as its own file in the plugins folder (named after its fingerprint, so a
// new version never clashes with the old one's cached code), then loaded. Removed again if unusable.
export async function installPlugin(dir: string, code: string): Promise<NexusPlugin> {
  await mkdir(dir, { recursive: true })
  const file = resolve(dir, `uploaded-${createHash('sha256').update(code).digest('hex').slice(0, 16)}.mjs`)
  await writeFile(file, code, { flag: 'wx' }).catch((error) => {
    if (error.code === 'EEXIST') throw new Error('This exact plugin is already installed')
    if (error.code === 'EACCES') throw new Error(`Nexus isn't allowed to write to the plugins folder (${dir})`)
    throw error
  })
  try {
    return await loadPlugin(file, file)
  } catch (error) {
    await rm(file, { force: true })
    throw error
  }
}

// Deletes a third-party plugin's file or folder. Node can't unload code it has run, so the old code
// stays in memory, unused, until Nexus restarts.
export async function removePlugin(id: string) {
  const plugin = plugins.get(id)
  if (!plugin || plugin.builtIn) throw new Error('Only plugins that were added to Nexus can be deleted')
  await rm(plugin.source!, { recursive: true, force: true })
  plugins.delete(id)
}

export const allPlugins = () => [...plugins.values()]
export const getPlugin = (id: string) => plugins.get(id)

export function capabilities(plugin: NexusPlugin) {
  return [plugin.saveAttachment && 'save-attachment', plugin.createEvent && 'create-event'].filter(Boolean) as string[]
}
