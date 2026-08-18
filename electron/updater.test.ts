import { describe, expect, it } from 'vitest'
import { buildUpdateFeedUrl, supportsAutomaticUpdates } from './updater'

describe('Folio automatic updates', () => {
  it('builds an architecture-specific public GitHub update feed', () => {
    expect(buildUpdateFeedUrl('darwin', 'arm64', '1.2.3')).toBe(
      'https://update.electronjs.org/kroist/folio/darwin-arm64/1.2.3',
    )
  })

  it('only enables updates for packaged macOS builds', () => {
    expect(supportsAutomaticUpdates(true, 'darwin')).toBe(true)
    expect(supportsAutomaticUpdates(false, 'darwin')).toBe(false)
    expect(supportsAutomaticUpdates(true, 'linux')).toBe(false)
    expect(supportsAutomaticUpdates(true, 'win32')).toBe(false)
  })
})
