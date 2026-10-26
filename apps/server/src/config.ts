// Every setting Nexus reads from the environment, checked once at startup.
import { z } from 'zod'

const schema = z.object({
  APP_SECRET: z
    .string()
    .min(32, 'APP_SECRET must be at least 32 characters. Generate one with: openssl rand -base64 48'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  PUBLIC_URL: z.string().url().default('http://localhost:8080'),
  PORT: z.coerce.number().default(8080),
  ALLOW_SIGNUP: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // Accept self-signed certificates on mail servers. Only for a mail server on your own network.
  MAIL_ALLOW_INSECURE_TLS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  PLUGINS_DIR: z.string().default('./plugins'),
  WEB_DIST: z.string().default('../web/dist'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  console.error('Nexus cannot start, the configuration is invalid:')
  for (const issue of parsed.error.issues) console.error(`  ${issue.path.join('.')}: ${issue.message}`)
  process.exit(1)
}

export const config = parsed.data
export const secureCookies = config.PUBLIC_URL.startsWith('https://')
