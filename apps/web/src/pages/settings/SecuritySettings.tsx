import { Laptop, Smartphone } from 'lucide-react'
import { useState } from 'react'
import { Button, Card, Chip, Field, Input } from '../../components/ui'

const sessions = [
  { device: 'Firefox on macOS', where: 'Amsterdam · this device', icon: Laptop, current: true },
  { device: 'Safari on iPhone', where: 'Amsterdam · 2 hours ago', icon: Smartphone, current: false },
]

export function SecuritySettings() {
  const [setup, setSetup] = useState(false)

  return (
    <>
      <Card title="Password">
        <form className="grid max-w-sm gap-3" onSubmit={(e) => e.preventDefault()}>
          <Field label="Current password"><Input type="password" autoComplete="current-password" /></Field>
          <Field label="New password" hint="At least 12 characters."><Input type="password" autoComplete="new-password" /></Field>
          <Button type="submit" variant="primary" className="justify-self-start">Change password</Button>
        </form>
      </Card>

      <Card
        title="Two-factor authentication"
        description="Ask for a code from an authenticator app every time you sign in."
        actions={<Chip color="var(--news)">On</Chip>}
      >
        {setup ? (
          <div className="grid gap-5 sm:grid-cols-[180px_1fr]">
            {/* Placeholder QR in the mock; the real one comes from the server. */}
            <div className="grid aspect-square place-items-center rounded-xl bg-white p-3" aria-label="QR code to scan">
              <div className="grid h-full w-full grid-cols-9 gap-0.5">
                {Array.from({ length: 81 }, (_, i) => <span key={i} className={(i * 7 + (i % 5)) % 3 === 0 ? 'bg-black' : ''} />)}
              </div>
            </div>
            <div className="grid content-start gap-3">
              <p>Scan this with your authenticator app, or enter the key by hand:</p>
              <code className="rounded-lg bg-raise px-3 py-2 font-mono text-[13px] tracking-wider">JBSW Y3DP EHPK 3PXP</code>
              <Field label="Code from the app"><Input inputMode="numeric" placeholder="123 456" autoComplete="one-time-code" /></Field>
              <div className="flex gap-2"><Button variant="primary">Verify and turn on</Button><Button variant="ghost" onClick={() => setSetup(false)}>Cancel</Button></div>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setSetup(true)}>Set up a new device</Button>
            <Button variant="secondary">Show recovery codes</Button>
            <Button variant="danger">Turn off</Button>
          </div>
        )}
      </Card>

      <Card title="Signed-in devices" description="Sign out anything you don’t recognise.">
        <ul className="divide-y divide-line">
          {sessions.map(({ device, where, icon: Icon, current }) => (
            <li key={device} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-raise text-muted"><Icon size={17} /></span>
              <div className="flex-1"><p className="font-medium">{device}</p><p className="text-[12.5px] text-muted">{where}</p></div>
              {current ? <Chip color="var(--news)">This device</Chip> : <Button variant="ghost">Sign out</Button>}
            </li>
          ))}
        </ul>
      </Card>
    </>
  )
}
