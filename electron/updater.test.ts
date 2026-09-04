import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  hasValidUpdateSignature,
  isNewerVersion,
  renderReleaseNotes,
  selectAvailableUpdate,
  supportsAutomaticUpdates,
} from './updater'

describe('Folio payload updates', () => {
  it('selects only complete newer releases', () => {
    const release = {
      tag_name: 'v1.0.4',
      body: '## Changes\n\n- Better updates',
      assets: [
        { name: 'Folio-1.0.4-update.zip', browser_download_url: 'https://example.com/update', size: 10 },
        { name: 'Folio-1.0.4-update.zip.sig', browser_download_url: 'https://example.com/signature', size: 88 },
      ],
    }
    expect(selectAvailableUpdate(release, '1.0.3')?.version).toBe('1.0.4')
    expect(selectAvailableUpdate(release, '1.0.3')?.releaseNotes).toContain('Better updates')
    expect(selectAvailableUpdate(release, '1.0.4')).toBeUndefined()
    expect(() => selectAvailableUpdate({ ...release, assets: [] }, '1.0.3')).toThrow(
      'has no signed update payload',
    )
    expect(isNewerVersion('1.1.0', '1.0.9')).toBe(true)
    expect(isNewerVersion('invalid', '1.0.9')).toBe(false)
  })

  it('renders safe release-note headings, lists, and emphasis', () => {
    const html = renderReleaseNotes('## Changes\n\n- **Faster** updates\n- <script>alert(1)</script>')
    expect(html).toContain('<h3>Changes</h3>')
    expect(html).toContain('<li><strong>Faster</strong> updates</li>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<script>')
  })

  it('verifies Ed25519 update signatures', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const payload = Buffer.from('folio update')
    const signature = sign(null, payload, privateKey)
    expect(hasValidUpdateSignature(payload, signature, publicKey)).toBe(true)
    expect(hasValidUpdateSignature(Buffer.from('tampered'), signature, publicKey)).toBe(false)
  })

  it('only enables updates in bootstrapped packaged macOS builds', () => {
    expect(supportsAutomaticUpdates(true, 'darwin', '/updates')).toBe(true)
    expect(supportsAutomaticUpdates(false, 'darwin', '/updates')).toBe(false)
    expect(supportsAutomaticUpdates(true, 'linux', '/updates')).toBe(false)
    expect(supportsAutomaticUpdates(true, 'darwin')).toBe(false)
  })
})
