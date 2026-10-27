// Turning plugins on, configuring them, and running their actions on a message.
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../../db.ts'
import { requireMessage } from '../../lib/access.ts'
import { decrypt, encrypt } from '../../lib/crypto.ts'
import { HttpError, badRequest, errorMessage, notFound, parse } from '../../lib/http.ts'
import { config } from '../../config.ts'
import { requireAdmin, requireUser, storageKey } from '../../lib/session.ts'
import { messageParts, openSummary } from '../mail/private.ts'
import { allPlugins, capabilities, getPlugin, installPlugin, removePlugin } from '../../plugins/registry.ts'
import { reviewPluginCode } from '../../plugins/review.ts'
import type { PluginEvent, PluginSettings } from '../../plugins/types.ts'

// Password fields are never sent back to the browser; this placeholder means "unchanged".
const HIDDEN = '••••••••'

async function savedSettings(userId: string, pluginId: string) {
  const row = await db.pluginSetting.findUnique({ where: { userId_pluginId: { userId, pluginId } } })
  return { enabled: row?.enabled ?? false, settings: (row ? JSON.parse(decrypt(row.settings)) : {}) as PluginSettings }
}

// The ids of plugins an admin turned off for everyone.
async function switchedOff(): Promise<Set<string>> {
  const rows = await db.serverPlugin.findMany({ where: { enabled: false } })
  return new Set(rows.map((r) => r.id))
}

// A plugin users may use: installed, and not turned off by an admin.
async function availablePlugin(pluginId: string) {
  const plugin = getPlugin(pluginId)
  if (!plugin || (await switchedOff()).has(pluginId)) throw notFound('Plugin')
  return plugin
}

async function enabledPlugin(userId: string, pluginId: string) {
  const plugin = await availablePlugin(pluginId)
  const { enabled, settings } = await savedSettings(userId, pluginId)
  if (!enabled) throw badRequest(`${plugin.name} is turned off. Turn it on in Settings → Plugins.`)
  return { plugin, settings }
}

// Plugin errors are about the user's other servers, so report them as a bad gateway with the plugin's own message.
async function runPlugin<T>(name: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    throw new HttpError(502, `${name}: ${errorMessage(error)}`)
  }
}

export async function pluginRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser)

  app.get('/plugins', async (request) => {
    const off = await switchedOff()
    return Promise.all(
      allPlugins()
        .filter((plugin) => !off.has(plugin.id))
        .map(async (plugin) => {
          const { enabled, settings } = await savedSettings(request.user.id, plugin.id)
          return {
            id: plugin.id,
            name: plugin.name,
            description: plugin.description,
            author: plugin.author,
            builtIn: plugin.builtIn,
            enabled,
            capabilities: capabilities(plugin),
            settings: plugin.settings.map((s) => ({
              ...s,
              value: s.type === 'password' && settings[s.key] ? HIDDEN : (settings[s.key] ?? ''),
            })),
          }
        }),
    )
  })

  app.put<{ Params: { id: string } }>('/plugins/:id', async (request) => {
    const plugin = await availablePlugin(request.params.id)
    const body = parse(
      z.object({ enabled: z.boolean().optional(), settings: z.record(z.string()).optional() }),
      request.body,
    )
    const current = await savedSettings(request.user.id, plugin.id)
    const settings = { ...current.settings }
    for (const field of plugin.settings) {
      const value = body.settings?.[field.key]
      if (value !== undefined && value !== HIDDEN) settings[field.key] = value.trim()
    }
    const enabled = body.enabled ?? current.enabled
    if (enabled) {
      const missing = plugin.settings.filter((f) => f.required && !settings[f.key]).map((f) => f.label)
      if (missing.length) throw badRequest(`Fill in ${missing.join(', ')} before turning ${plugin.name} on`)
    }
    const data = { enabled, settings: encrypt(JSON.stringify(settings)) }
    await db.pluginSetting.upsert({
      where: { userId_pluginId: { userId: request.user.id, pluginId: plugin.id } },
      create: { ...data, userId: request.user.id, pluginId: plugin.id },
      update: data,
    })
    return { ok: true }
  })

  app.post<{ Params: { id: string } }>('/plugins/:id/test', async (request) => {
    const plugin = await availablePlugin(request.params.id)
    if (!plugin.testConnection) throw notFound('Plugin test')
    const { settings } = await savedSettings(request.user.id, plugin.id)
    await runPlugin(plugin.name, () => plugin.testConnection!(settings))
    return { ok: true }
  })

  app.post<{ Params: { id: string } }>('/plugins/:id/save-attachment', async (request) => {
    const { messageId, attachmentId } = parse(
      z.object({ messageId: z.string(), attachmentId: z.string() }),
      request.body,
    )
    const { plugin, settings } = await enabledPlugin(request.user.id, request.params.id)
    if (!plugin.saveAttachment) throw badRequest(`${plugin.name} can't save attachments`)
    const message = await requireMessage(request.user.id, messageId, 'viewer')
    const file = (await messageParts(message.id, await storageKey(request)))[Number(attachmentId)]
    if (!file) throw notFound('Attachment')
    return runPlugin(plugin.name, () =>
      plugin.saveAttachment!(
        { filename: file.filename ?? 'attachment', contentType: file.contentType, content: file.content },
        settings,
      ),
    )
  })

  app.post<{ Params: { id: string } }>('/plugins/:id/create-event', async (request) => {
    const { messageId } = parse(z.object({ messageId: z.string() }), request.body)
    const { plugin, settings } = await enabledPlugin(request.user.id, request.params.id)
    if (!plugin.createEvent) throw badRequest(`${plugin.name} can't create events`)
    const message = await requireMessage(request.user.id, messageId, 'viewer')
    const { event } = openSummary(message, await storageKey(request))
    if (!event) throw notFound('Event in this message')
    return runPlugin(plugin.name, () => plugin.createEvent!(event as PluginEvent, settings))
  })

  // Admins: which plugins the server has, turning them on or off for everyone, and adding or deleting them.
  app.register(async (admin) => {
    admin.addHook('preHandler', requireAdmin)
    const codeSchema = z.object({
      code: z
        .string()
        .min(1)
        .max(1024 * 1024, 'A plugin file can be at most 1 MB'),
    })

    admin.get('/admin/plugins', async () => {
      const off = await switchedOff()
      const users = await db.pluginSetting.groupBy({ by: ['pluginId'], where: { enabled: true }, _count: true })
      return allPlugins().map((plugin) => ({
        id: plugin.id,
        name: plugin.name,
        description: plugin.description,
        author: plugin.author,
        builtIn: plugin.builtIn,
        enabled: !off.has(plugin.id),
        users: users.find((u) => u.pluginId === plugin.id)?._count ?? 0,
      }))
    })

    // Step 1 of adding a plugin: look at the code without running it (see plugins/review.ts).
    admin.post('/admin/plugins/review', async (request) => reviewPluginCode(parse(codeSchema, request.body).code))

    // Step 2: install it. The fingerprint from step 1 must match, so what runs is exactly what was reviewed.
    admin.post('/admin/plugins', async (request) => {
      const { code, sha256 } = parse(codeSchema.extend({ sha256: z.string() }), request.body)
      if (reviewPluginCode(code).sha256 !== sha256) throw badRequest('The code changed since it was reviewed')
      const plugin = await installPlugin(config.PLUGINS_DIR, code).catch((error) => {
        throw badRequest(`Couldn't install this plugin: ${errorMessage(error)}`)
      })
      request.log.warn({ plugin: plugin.id, sha256, admin: request.user.email }, 'plugin installed')
      return { id: plugin.id, name: plugin.name }
    })

    admin.put<{ Params: { id: string } }>('/admin/plugins/:id', async (request) => {
      const { enabled } = parse(z.object({ enabled: z.boolean() }), request.body)
      if (!getPlugin(request.params.id)) throw notFound('Plugin')
      await db.serverPlugin.upsert({
        where: { id: request.params.id },
        create: { id: request.params.id, enabled },
        update: { enabled },
      })
      return { ok: true }
    })

    // Deletes the plugin's code, and everyone's settings for it (they may hold passwords for other services).
    admin.delete<{ Params: { id: string } }>('/admin/plugins/:id', async (request) => {
      if (!getPlugin(request.params.id)) throw notFound('Plugin')
      await removePlugin(request.params.id).catch((error) => {
        throw badRequest(errorMessage(error))
      })
      await db.pluginSetting.deleteMany({ where: { pluginId: request.params.id } })
      await db.serverPlugin.deleteMany({ where: { id: request.params.id } })
      return { ok: true }
    })
  })
}
