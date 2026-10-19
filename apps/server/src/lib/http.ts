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
