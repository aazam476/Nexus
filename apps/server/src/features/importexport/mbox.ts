// The mbox format (mboxrd variant): many messages in one file, each starting with a "From " line.
// Lines inside a message that start with "From " are escaped with ">" so they aren't mistaken for a new message.
// Everything works on latin1 strings, which map bytes 1:1, so non-UTF-8 mail survives untouched.

export function splitMbox(file: Buffer): Buffer[] {
  const text = file.toString('latin1')
  return text
    .split(/^From .*\r?\n/m)
    .slice(1) // anything before the first "From " line is not a message
    .map((message) => message.replace(/\r?\n$/, '').replace(/^>(>*From )/gm, '$1'))
    .filter((message) => message.trim())
    .map((message) => Buffer.from(message, 'latin1'))
}

export function toMbox(messages: { raw: Buffer; fromEmail: string; date: Date }[]): Buffer {
  const parts = messages.map(({ raw, fromEmail, date }) => {
    const body = raw.toString('latin1').replace(/^(>*From )/gm, '>$1')
    // asctime-style date, as mbox expects: "Sun Oct 19 09:42:00 2026"
    const stamp = date.toUTCString().replace(/^(\w+), (\d+) (\w+) (\d+) ([\d:]+) GMT$/, '$1 $3 $2 $5 $4')
    return `From ${fromEmail || 'MAILER-DAEMON'} ${stamp}\n${body}${body.endsWith('\n') ? '' : '\n'}\n`
  })
  return Buffer.from(parts.join(''), 'latin1')
}
