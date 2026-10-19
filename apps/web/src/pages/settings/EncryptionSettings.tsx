import { Download, KeyRound, Plus, Upload } from 'lucide-react'
import { Button, Card, Chip } from '../../components/ui'

export function EncryptionSettings() {
  return (
    <>
      <Card
        title="PGP keys"
        description="Keys are generated and used in your browser. Nexus stores your private key only in passphrase-encrypted form, so the server can never read your encrypted mail."
        actions={<div className="flex gap-2"><Button variant="secondary"><Upload size={15} /> Import</Button><Button variant="primary"><Plus size={15} /> Generate key</Button></div>}
      >
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-raise p-4">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-panel text-news"><KeyRound size={18} /></span>
          <div className="min-w-0 flex-1">
            <p className="font-medium">Ali Azam &lt;ali@azam.email&gt;</p>
            <code className="block truncate font-mono text-[12.5px] text-muted">7F2C 1A90 B3D4 4E61 0C8A  92F1 5D3E 7B20 A1C4 9E88</code>
            <p className="text-[12.5px] text-muted">Ed25519 · created 2025-06-02 · expires 2027-06-02</p>
          </div>
          <Chip color="var(--news)">Default</Chip>
          <Button variant="ghost" title="Export public key" aria-label="Export public key"><Download size={15} /></Button>
        </div>
        <label className="mt-4 flex items-center gap-2 text-[13px] text-ink-2">
          <input type="checkbox" defaultChecked className="accent-[var(--accent)]" /> Attach my public key to outgoing mail
        </label>
        <label className="mt-2 flex items-center gap-2 text-[13px] text-ink-2">
          <input type="checkbox" className="accent-[var(--accent)]" /> Encrypt by default when every recipient has a key
        </label>
      </Card>

      <Card
        title="S/MIME certificate"
        description="Upload a certificate from your organisation or a CA as a .p12 file. Used to sign and decrypt S/MIME mail."
        actions={<Button variant="secondary"><Upload size={15} /> Upload .p12</Button>}
      >
        <p className="text-muted">No certificate yet.</p>
      </Card>
    </>
  )
}
