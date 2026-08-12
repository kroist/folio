import { describe, expect, it } from 'vitest'
import { parseThemePreference, resolveThemePreference, themeScheme } from './themes'

describe('theme preferences', () => {
  it('accepts known themes and rejects stale values', () => {
    expect(parseThemePreference('dark-plus')).toBe('dark-plus')
    expect(parseThemePreference('nord')).toBe('system')
    expect(parseThemePreference('unknown-theme')).toBe('system')
    expect(parseThemePreference(null)).toBe('system')
  })

  it('resolves System against the operating-system appearance', () => {
    expect(resolveThemePreference('system', false)).toBe('vscode-light')
    expect(resolveThemePreference('system', true)).toBe('vscode-dark')
    expect(resolveThemePreference('dark-modern', false)).toBe('dark-modern')
  })

  it('exposes the color scheme for native controls', () => {
    expect(themeScheme('high-contrast-light')).toBe('light')
    expect(themeScheme('visual-studio-dark')).toBe('dark')
  })
})
