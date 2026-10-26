// The small badge saying whether a message was encrypted or signed, and whether the signature checks out.
import { Lock, ShieldCheck, ShieldX } from 'lucide-react'
import type { Message } from '../../types'
import { Chip } from '../ui'

export function SecurityChip({ message }: { message: Message }) {
  switch (message.security) {
    case 'pgp-encrypted':
      return (
        <Chip color="var(--news)">
          <Lock size={12} /> PGP encrypted
        </Chip>
      )
    case 'pgp-signed':
      return (
        <Chip color="var(--muted)">
          <ShieldCheck size={12} /> PGP signed
        </Chip>
      )
    case 'smime-encrypted':
      return (
        <Chip color="var(--news)">
          <Lock size={12} /> S/MIME encrypted
        </Chip>
      )
    case 'smime-signed':
      return <SmimeSignatureChip signature={message.signature} />
    default:
      return null
  }
}

// The server checks S/MIME signatures (see server/features/send/smime.ts, verify()):
//   trusted   – intact, from a certificate authority this server trusts
//   untrusted – intact, but the certificate is self-signed or from an unknown authority
//   invalid   – the message was changed after it was signed
function SmimeSignatureChip({ signature }: { signature: Message['signature'] }) {
  if (signature === 'trusted') {
    return (
      <Chip color="var(--news)">
        <ShieldCheck size={12} /> S/MIME signed · verified
      </Chip>
    )
  }
  if (signature === 'untrusted') {
    return (
      <Chip color="var(--notif)">
        <ShieldCheck size={12} /> S/MIME signed · unverified issuer
      </Chip>
    )
  }
  if (signature === 'invalid') {
    return (
      <Chip color="var(--danger)">
        <ShieldX size={12} /> Signature broken: the message was changed
      </Chip>
    )
  }
  return (
    <Chip color="var(--muted)">
      <ShieldCheck size={12} /> S/MIME signed
    </Chip>
  )
}
