import { describe, expect, it } from 'vitest'
import { cycleMatchIndex, findTextMatches } from './documentSearch'

describe('document search', () => {
  it('finds literal, case-insensitive, non-overlapping matches', () => {
    expect(findTextMatches('Alpha alpha ALPHA', 'alpha')).toEqual([
      { from: 0, to: 5 },
      { from: 6, to: 11 },
      { from: 12, to: 17 },
    ])
    expect(findTextMatches('a.b a-b', 'a.b')).toEqual([{ from: 0, to: 3 }])
    expect(findTextMatches('aaaa', 'aa')).toEqual([
      { from: 0, to: 2 },
      { from: 2, to: 4 },
    ])
  })

  it('returns no matches for an empty query', () => {
    expect(findTextMatches('text', '')).toEqual([])
  })

  it('cycles forward and backward with wrapping', () => {
    expect(cycleMatchIndex(-1, 3, 1)).toBe(0)
    expect(cycleMatchIndex(-1, 3, -1)).toBe(2)
    expect(cycleMatchIndex(2, 3, 1)).toBe(0)
    expect(cycleMatchIndex(0, 3, -1)).toBe(2)
    expect(cycleMatchIndex(0, 0, 1)).toBe(-1)
  })
})
