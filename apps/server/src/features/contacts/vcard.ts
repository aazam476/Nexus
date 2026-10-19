// Reading and writing contacts as vCard (.vcf), the format every address book understands.

export interface VcardContact {
  name: string
  emails: string[]
  phone?: string
  company?: string
}

const unescape = (value: string) => value.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1')
const escape = (value: string) => value.replace(/([\\,;])/g, '\\$1').replace(/\n/g, '\\n')

export function parseVcards(text: string): VcardContact[] {
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/) // undo line folding
  const contacts: VcardContact[] = []
  let current: VcardContact | null = null

  for (const line of lines) {
    const upper = line.toUpperCase()
    if (upper === 'BEGIN:VCARD') current = { name: '', emails: [] }
    else if (upper === 'END:VCARD' && current) {
      if (!current.name) current.name = current.emails[0] ?? 'Unnamed'
      if (current.emails.length) contacts.push(current)
      current = null
    } else if (current) {
      const colon = line.indexOf(':')
      if (colon === -1) continue
      const key = line.slice(0, colon).split(';')[0].split('.').pop()!.toUpperCase() // "item1.EMAIL;TYPE=work" -> "EMAIL"
      const value = unescape(line.slice(colon + 1).trim())
      if (key === 'FN') current.name = value
      if (key === 'EMAIL' && value) current.emails.push(value.toLowerCase())
      if (key === 'TEL' && !current.phone) current.phone = value
      if (key === 'ORG') current.company = value.split(';')[0]
    }
  }
  return contacts
}

export function toVcards(contacts: VcardContact[]): string {
  return contacts
    .map((c) =>
      [
        'BEGIN:VCARD',
        'VERSION:3.0',
        `FN:${escape(c.name)}`,
        `N:${escape(c.name)};;;;`,
        ...c.emails.map((e) => `EMAIL;TYPE=INTERNET:${e}`),
        c.phone && `TEL:${escape(c.phone)}`,
        c.company && `ORG:${escape(c.company)}`,
        'END:VCARD',
      ]
        .filter(Boolean)
        .join('\r\n'),
    )
    .join('\r\n')
}
