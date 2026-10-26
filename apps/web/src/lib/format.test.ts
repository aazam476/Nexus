import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatListDate, formatSize } from './format'

describe('formatListDate', () => {
  // Pretend it is Wednesday 15 May 2030, 14:00 local time.
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2030, 4, 15, 14, 0))
  })
  afterEach(() => vi.useRealTimers())

  it('shows the time for today, "Yesterday", the weekday this week, then the date', () => {
    expect(formatListDate(new Date(2030, 4, 15, 9, 5).toISOString())).toMatch(/09.05/)
    expect(formatListDate(new Date(2030, 4, 14, 22, 0).toISOString())).toBe('Yesterday')
    expect(formatListDate(new Date(2030, 4, 11, 12, 0).toISOString())).toBe(new Date(2030, 4, 11).toLocaleDateString([], { weekday: 'short' }))
    expect(formatListDate(new Date(2030, 0, 2, 12, 0).toISOString())).toBe(new Date(2030, 0, 2).toLocaleDateString([], { day: 'numeric', month: 'short' }))
  })
})

describe('formatSize', () => {
  it('uses bytes, KB or MB', () => {
    expect(formatSize(512)).toBe('512 B')
    expect(formatSize(2048)).toBe('2 KB')
    expect(formatSize(5.5 * 1024 * 1024)).toBe('5.5 MB')
  })
})
