// Turning plugins on, configuring them, and running their actions on a message.
import type { FastifyInstance } from 'fastify'
import { simpleParser } from 'mailparser'
import { z } from 'zod'
import { db } from '../../db.ts'
import { loadBody, requireMessage } from '../../lib/access.ts'
import { decrypt, encrypt } from '../../lib/crypto.ts'
import { HttpError, badRequest, notFound, parse } from '../../lib/http.ts'
import { requireUser, storageKey } from '../../lib/session.ts'
import { openBody, openSummary } from '../mail/private.ts'
import { allPlugins, capabilities, getPlugin } from '../../plugins/registry.ts'
import type { PluginEvent, PluginSettings } from '../../plugins/types.ts'

// Password fields are never sent back to the browser; this placeholder means "unchanged".
const HIDDEN = '••••••••'

async function savedSettings(userId: string, pluginId: string) {
  const row = await db.pluginSetting.findUnique({ where: { userId_pluginId: { userId, pluginId } } })
  return { enabled: row?.enabled ?? false, settings: (row ? JSON.parse(decrypt(row.settings)) : {}) as PluginSettings }
}

async function enabledPlugin(userId: string, pluginId: string) {
  const plugin = getPlugin(pluginId)
  if (!plugin) throw notFound('Plugin')
  const { enabled, settings } = await savedSettings(userId, pluginId)
  if (!enabled) throw badRequest(`${plugin.name} is turned off. Turn it on in Settings → Plugins.`)
  return { plugin, settings }
}

// Plugin errors are about the user's other servers, so report them as a bad gateway with the plugin's own message.
async function runPlugin<T>(name: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    throw new HttpError(502, `${name}: ${(error as Error).message}`)
  }
}

export async function pluginRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser)

  app.get('/plugins', async (request) =>
    Promise.all(
      allPlugins().map(async (plugin) => {
        const { enabled, settings } = await savedSettings(request.user.id, plugin.id)
        return {
          id: plugin.id,
          name: plugin.name,
          description: plugin.description,
          author: plugin.author,
          builtIn: plugin.builtIn,
          enabled,
          capabilities: capabilities(plugin),
          settings: plugin.settings.map((s) => ({ ...s, value: s.type === 'password' && settings[s.key] ? HIDDEN : (settings[s.key] ?? '') })),
        }
      }),
    ),
  )

  app.put<{ Params: { id: string } }>('/plugins/:id', async (request) => {
    const plugin = getPlugin(request.params.id)
    if (!plugin) throw notFound('Plugin')
    const body = parse(z.object({ enabled: z.boolean().optional(), settings: z.record(z.string()).optional() }), request.body)
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
    await db.pluginSetting.upsert({ where: { userId_pluginId: { userId: request.user.id, pluginId: plugin.id } }, create: { ...data, userId: request.user.id, pluginId: plugin.id }, update: data })
    return { ok: true }
  })

  app.post<{ Params: { id: string } }>('/plugins/:id/test', async (request) => {
    const plugin = getPlugin(request.params.id)
    if (!plugin?.testConnection) throw notFound('Plugin test')
    const { settings } = await savedSettings(request.user.id, plugin.id)
    await runPlugin(plugin.name, () => plugin.testConnection!(settings))
    return { ok: true }
  })

  app.post<{ Params: { id: string } }>('/plugins/:id/save-attachment', async (request) => {
    const { messageId, attachmentId } = parse(z.object({ messageId: z.string(), attachmentId: z.string() }), request.body)
    const { plugin, settings } = await enabledPlugin(request.user.id, request.params.id)
    if (!plugin.saveAttachment) throw badRequest(`${plugin.name} can't save attachments`)
    const message = await requireMessage(request.user.id, messageId, 'viewer')
    const file = (await simpleParser(openBody(await loadBody(message.id), await storageKey(request)).raw)).attachments[Number(attachmentId)]
    if (!file) throw notFound('Attachment')
    return runPlugin(plugin.name, () =>
      plugin.saveAttachment!({ filename: file.filename ?? 'attachment', contentType: file.contentType, content: file.content }, settings),
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
}
