import { describe, expect, it } from 'vitest'
import { parseLineWrappingPreference } from './editorPreferences'

describe('parseLineWrappingPreference', () => {
  it('defaults line wrapping to enabled', () => {
    expect(parseLineWrappingPreference(null)).toBe(true)
    expect(parseLineWrappingPreference('true')).toBe(true)
  })

  it('honors an explicitly disabled preference', () => {
    expect(parseLineWrappingPreference('false')).toBe(false)
  })
})
