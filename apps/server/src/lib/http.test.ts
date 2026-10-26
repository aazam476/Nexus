import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { HttpError, errorMessage, parse } from './http.ts'

describe('errorMessage', () => {
  it('uses the message when there is one', () => {
    expect(errorMessage(new Error('Login failed'))).toBe('Login failed')
  })

  it('looks inside an AggregateError, whose own message is empty', () => {
    const refused = new AggregateError(
      [Object.assign(new Error('connect ECONNREFUSED ::1:993'), { code: 'ECONNREFUSED' })],
      '',
    )
    expect(errorMessage(refused)).toBe('connect ECONNREFUSED ::1:993')
  })

  it('falls back to the error code, and explains a refused connection', () => {
    expect(errorMessage(Object.assign(new Error(''), { code: 'ECONNREFUSED' }))).toMatch(/server name and port/)
    expect(errorMessage(Object.assign(new Error(''), { code: 'ETIMEDOUT' }))).toBe('ETIMEDOUT')
    expect(errorMessage('plain text')).toBe('plain text')
  })
})

describe('parse', () => {
  const schema = z.object({ email: z.string().email() })

  it('returns valid input', () => {
    expect(parse(schema, { email: 'a@b.test' })).toEqual({ email: 'a@b.test' })
  })

  it('throws a 400 that names the field', () => {
    try {
      parse(schema, { email: 'nope' })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError)
      expect((error as HttpError).status).toBe(400)
      expect((error as HttpError).message).toMatch(/^email: /)
    }
  })
})
