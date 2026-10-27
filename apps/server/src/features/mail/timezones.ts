// Turning a clock time in a named time zone ("10:25 in Europe/Oslo") into an exact moment (UTC).
// Calendar invites write times that way. No library needed: Node ships the full time-zone database,
// and Intl.DateTimeFormat can tell what a clock in any zone shows at any moment.

// Outlook names zones the Windows way ("W. Europe Standard Time"), which Intl doesn't know.
// These are the common ones, with the standard (IANA) name they stand for. The full list is
// "windowsZones" in the Unicode CLDR project, if more are ever needed.
const WINDOWS_ZONES: Record<string, string> = {
  UTC: 'UTC',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Romance Standard Time': 'Europe/Paris',
  'Central European Standard Time': 'Europe/Warsaw',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'FLE Standard Time': 'Europe/Kiev',
  'GTB Standard Time': 'Europe/Bucharest',
  'Russian Standard Time': 'Europe/Moscow',
  'Turkey Standard Time': 'Europe/Istanbul',
  'Israel Standard Time': 'Asia/Jerusalem',
  'Arabian Standard Time': 'Asia/Dubai',
  'India Standard Time': 'Asia/Kolkata',
  'China Standard Time': 'Asia/Shanghai',
  'Singapore Standard Time': 'Asia/Singapore',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'Korea Standard Time': 'Asia/Seoul',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'New Zealand Standard Time': 'Pacific/Auckland',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'US Mountain Standard Time': 'America/Phoenix',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Alaskan Standard Time': 'America/Anchorage',
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  'Atlantic Standard Time': 'America/Halifax',
  'E. South America Standard Time': 'America/Sao_Paulo',
  'SA Pacific Standard Time': 'America/Bogota',
  'South Africa Standard Time': 'Africa/Johannesburg',
}

// The standard name for a zone, or null if it's one we can't recognise.
function knownZone(name: string): string | null {
  const zone = WINDOWS_ZONES[name] ?? name
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone }) // throws for unknown zones
    return zone
  } catch {
    return null
  }
}

// What a clock in `timeZone` shows at moment `instant`, written as if that reading were UTC.
// For example, at 09:25 UTC a clock in Oslo (one hour ahead in winter) shows 10:25, so this returns
// the moment "10:25 UTC". The difference between the two is the zone's offset at that moment.
function clockReading(instant: number, timeZone: string): number {
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const part = Object.fromEntries(format.formatToParts(instant).map((p) => [p.type, Number(p.value)]))
  return Date.UTC(part.year, part.month - 1, part.day, part.hour, part.minute, part.second)
}

// The exact moment when clocks in `zoneName` show this time, as an ISO string ending in "Z".
// Returns null for zones we can't recognise, so the caller can fall back.
export function zonedTimeToUtc(
  time: { year: number; month: number; day: number; hour: number; minute: number; second: number },
  zoneName: string,
): string | null {
  const zone = knownZone(zoneName)
  if (!zone) return null
  const asIfUtc = Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute, time.second)
  // First guess: subtract the zone's offset as it is around that time…
  let instant = asIfUtc - (clockReading(asIfUtc, zone) - asIfUtc)
  // …then check again at the guess, in case daylight saving time starts or ends in between.
  instant = asIfUtc - (clockReading(instant, zone) - instant)
  return new Date(instant).toISOString()
}
