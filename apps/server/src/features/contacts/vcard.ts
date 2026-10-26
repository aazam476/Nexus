// Reading and writing contacts as vCard (.vcf), the format every address book understands.

export interface VcardContact {
  name: string
  emails: string[]
  phone?: string
  company?: string
}

// In vCard text, commas, semicolons and backslashes are written with a backslash in front ("\,"),
// and line breaks as "\n". These two undo and redo that.
const unescape = (value: string) =>
  value
    .replace(/\\n/gi, '\n') // "\n" → a real line break
    .replace(/\\([,;\\])/g, '$1') // "\," → ","   "\;" → ";"   "\\" → "\"
const escape = (value: string) =>
  value
    .replace(/([\\,;])/g, '\\$1') // "," → "\,"  and so on
    .replace(/\n/g, '\\n')

// Long lines in a .vcf file are "folded": continued on the next line, which starts with a space
// or tab. Joining them back gives one line per property.
const unfold = (text: string) => text.replace(/\r?\n[ \t]/g, '')

// The property name of a line like "item1.EMAIL;TYPE=work:ann@x.com" is "EMAIL": drop the
// parameters after ";" and the "item1." group prefix some apps add.
function propertyName(line: string, colon: number): string {
  const beforeParameters = line.slice(0, colon).split(';')[0]
  return beforeParameters.split('.').pop()!.toUpperCase()
}

export function parseVcards(text: string): VcardContact[] {
  const lines = unfold(text).split(/\r?\n/)
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
      const key = propertyName(line, colon)
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
