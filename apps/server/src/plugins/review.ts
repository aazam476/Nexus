// A quick look at a plugin's code before an admin installs it, without running it.
//
// A plugin runs inside Nexus with the same access as Nexus itself, and no automatic check can prove
// code is safe: a determined author can hide anything. So this doesn't say "safe". It points out the
// powerful things the code appears to do, so the admin knows what to read closely, and gives its
// fingerprint (SHA-256) to compare with the one the author publishes.
import { createHash } from 'node:crypto'

export interface PluginReview {
  sha256: string
  size: number // in bytes
  findings: string[] // plain-English notes, most worrying first; empty when nothing stood out
}

// What to look for, and what it means for the admin. Each pattern matches typical ways of writing it.
const CHECKS: { pattern: RegExp; note: string }[] = [
  { pattern: /child_process|\bexecSync\b|\bspawn\(/, note: 'Runs other programs on the server.' },
  { pattern: /\beval\s*\(|new\s+Function\s*\(/, note: 'Builds and runs code while running, which hides what it does.' },
  { pattern: /\bimport\s*\(/, note: 'Loads more code while running, which this check can’t see.' },
  {
    pattern: /process\.env/,
    note: 'Reads the server’s settings, which include secrets like APP_SECRET and the database password.',
  },
  { pattern: /@prisma\/client|['"]pg['"]|DATABASE_URL/, note: 'Talks to the database directly, where all mail is.' },
  { pattern: /['"](node:)?fs(\/promises)?['"]/, note: 'Reads or writes files on the server.' },
  { pattern: /['"](node:)?(net|dgram|tls)['"]/, note: 'Opens raw network connections.' },
  { pattern: /[A-Za-z0-9+/=]{300,}/, note: 'Contains a long encoded blob, which may hide code or data.' },
]

export function reviewPluginCode(code: string): PluginReview {
  return {
    sha256: createHash('sha256').update(code).digest('hex'),
    size: Buffer.byteLength(code),
    findings: CHECKS.filter((check) => check.pattern.test(code)).map((check) => check.note),
  }
}
