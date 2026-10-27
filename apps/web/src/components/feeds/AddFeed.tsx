// The "Follow" box: paste a feed's address, or a website's (Nexus finds the feed it announces).
import { useState, type FormEvent } from 'react'
import { api } from '../../lib/api'
import { Button, Input } from '../ui'

export function AddFeed({ onAdded }: { onAdded: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function follow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const url = String(new FormData(form).get('url') ?? '')
    setBusy(true)
    setError('')
    try {
      await api('/feeds', { body: { url } }) // the server fetches it now, so a bad address fails here
      form.reset()
      onAdded()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={follow} className="grid gap-1.5">
      <div className="flex gap-2">
        <Input
          name="url"
          type="url"
          required
          placeholder="https://example.com or its feed"
          aria-label="Feed or website address"
        />
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Adding…' : 'Follow'}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
    </form>
  )
}
