// Talking to the Nexus server. Every request goes through `api()` so errors look the same everywhere.

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function api<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown; form?: FormData } = {},
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: options.method ?? (options.body !== undefined || options.form ? 'POST' : 'GET'),
    headers: options.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: options.form ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
    credentials: 'same-origin',
  })
  const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : null
  if (!response.ok) throw new ApiError(response.status, data?.error ?? `Request failed (${response.status})`)
  return data as T
}

export const put = <T = unknown>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body })
export const patch = <T = unknown>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body })
export const del = <T = unknown>(path: string) => api<T>(path, { method: 'DELETE' })

// Files the server reads as base64 inside JSON (attachments, certificates).
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}
