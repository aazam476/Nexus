// Errors and input validation for route handlers.
import type { z } from 'zod'

// Throw one of these from a route and the error handler in app.ts turns it into a JSON response.
export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

// A readable reason for any error. Some network errors carry no message of their own: when a
// host name has two addresses (IPv4 and IPv6) and both refuse, Node throws an AggregateError
// whose message is empty, with the real errors inside it.
export function errorMessage(error: unknown): string {
  const e = error as { message?: string; code?: string; errors?: unknown[] }
  if (e?.message) return e.message
  if (e?.errors?.length) return errorMessage(e.errors[0])
  if (e?.code === 'ECONNREFUSED') return 'Connection refused: is the server name and port right?'
  return e?.code ?? String(error)
}

export const badRequest = (message: string) => new HttpError(400, message)
export const forbidden = (message = 'You do not have access to this') => new HttpError(403, message)
export const notFound = (what: string) => new HttpError(404, `${what} not found`)

// Validate untrusted input. Returns typed data or throws a 400 that names the bad field.
export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data)
  if (!result.success) {
    const issue = result.error.issues[0]
    throw badRequest(issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message)
  }
  return result.data
}
