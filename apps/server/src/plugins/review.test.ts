// The quick look at plugin code before an admin installs it.
import { describe, expect, it } from 'vitest'
import { reviewPluginCode } from './review.ts'

describe('reviewPluginCode', () => {
  it('finds nothing to point out in an ordinary plugin', () => {
    const review = reviewPluginCode(
      `export default { id: 'x', async saveAttachment() { await fetch('https://a.test') } }`,
    )
    expect(review.findings).toEqual([])
    expect(review.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('points out running programs, reading secrets, and hidden code', () => {
    const findings = reviewPluginCode(
      `import { exec } from 'node:child_process'; const s = process.env.APP_SECRET; eval('${'A'.repeat(400)}')`,
    ).findings
    expect(findings).toEqual([
      'Runs other programs on the server.',
      'Builds and runs code while running, which hides what it does.',
      'Reads the server’s settings, which include secrets like APP_SECRET and the database password.',
      'Contains a long encoded blob, which may hide code or data.',
    ])
  })

  it('gives the same fingerprint for the same code only', () => {
    expect(reviewPluginCode('a').sha256).toBe(reviewPluginCode('a').sha256)
    expect(reviewPluginCode('a').sha256).not.toBe(reviewPluginCode('b').sha256)
  })
})
