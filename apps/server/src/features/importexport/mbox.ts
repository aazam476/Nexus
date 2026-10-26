// The mbox format (mboxrd variant): many messages in one file, each starting with a "From " line.
// Lines inside a message that start with "From " are escaped with ">" so they aren't mistaken for a new message.
// Everything works on latin1 strings, which map bytes 1:1, so non-UTF-8 mail survives untouched.

export function splitMbox(file: Buffer): Buffer[] {
  const text = file.toString('latin1')
  return (
    text
      // Cut at every line that starts with "From " (the separator line itself is dropped).
      .split(/^From .*\r?\n/m)
      .slice(1) // anything before the first "From " line is not a message
      .map(
        (message) =>
          message
            .replace(/\r?\n$/, '') // the blank line that ends each message
            .replace(/^>(>*From )/gm, '$1'), // undo the escaping: ">From " → "From ", ">>From " → ">From "
      )
      .filter((message) => message.trim())
      .map((message) => Buffer.from(message, 'latin1'))
  )
}

// The date style mbox separator lines use, in UTC: "Sun Oct 19 09:42:00 2026".
function mboxDate(date: Date): string {
  // toUTCString() gives "Sun, 19 Oct 2026 09:42:00 GMT"; reorder its parts.
  const [weekday, day, month, year, time] = date.toUTCString().replace(',', '').split(' ')
  return `${weekday} ${month} ${day} ${time} ${year}`
}

export function toMbox(messages: { raw: Buffer; fromEmail: string; date: Date }[]): Buffer {
  const parts = messages.map(({ raw, fromEmail, date }) => {
    // Escape lines that would look like a separator: "From " → ">From ", ">From " → ">>From ".
    const body = raw.toString('latin1').replace(/^(>*From )/gm, '>$1')
    const separator = `From ${fromEmail || 'MAILER-DAEMON'} ${mboxDate(date)}`
    const ending = body.endsWith('\n') ? '\n' : '\n\n' // each message ends with one blank line
    return `${separator}\n${body}${ending}`
  })
  return Buffer.from(parts.join(''), 'latin1')
}
