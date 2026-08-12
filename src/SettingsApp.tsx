import { Bot, Cloud, Palette } from 'lucide-react'
import { useEffect, useState } from 'react'
import { AppearanceSettings } from './components/AppearanceSettings'
import { AgentSettings } from './components/AgentSettings'
import { VaultSettings } from './components/VaultSettings'
import {
  LINE_WRAPPING_STORAGE_KEY,
  parseLineWrappingPreference,
} from './lib/editorPreferences'
import {
  parseThemePreference,
  resolveThemePreference,
  themeScheme,
  type ThemePreference,
} from './lib/themes'
import type { VaultInfo } from './types'

type SettingsSection = 'appearance' | 'vault' | 'agents'

const initialSection = (): SettingsSection => {
  const section = new URLSearchParams(window.location.search).get('section')
  return section === 'vault' || section === 'agents' ? section : 'appearance'
}

export function SettingsApp() {
  const [section, setSection] = useState<SettingsSection>(initialSection)
  const [themePreference, setThemePreference] = useState<ThemePreference>(() =>
    parseThemePreference(window.localStorage.getItem('folio.theme')),
  )
  const [systemDark, setSystemDark] = useState(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches,
  )
  const [vaultInfo, setVaultInfo] = useState<VaultInfo>()
  const [lineWrapping, setLineWrapping] = useState(() =>
    parseLineWrappingPreference(window.localStorage.getItem(LINE_WRAPPING_STORAGE_KEY)),
  )

  useEffect(() => window.folio.onSettingsSection(setSection), [])
  useEffect(() => window.folio.onVaultInfoChanged(setVaultInfo), [])
  useEffect(() => window.folio.onThemePreference((preference) => {
    setThemePreference(preference)
    window.localStorage.setItem('folio.theme', preference)
  }), [])
  useEffect(() => window.folio.onLineWrappingPreference((enabled) => {
    setLineWrapping(enabled)
    window.localStorage.setItem(LINE_WRAPPING_STORAGE_KEY, String(enabled))
  }), [])
  useEffect(() => {
    void window.folio.getVaultInfo().then(setVaultInfo)
  }, [])
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [])

  const resolvedTheme = resolveThemePreference(themePreference, systemDark)
  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme
    document.documentElement.style.colorScheme = themeScheme(resolvedTheme)
  }, [resolvedTheme])

  const selectTheme = (preference: ThemePreference) => {
    setThemePreference(preference)
    window.localStorage.setItem('folio.theme', preference)
    void window.folio.setThemePreference(preference)
  }

  return (
    <main className="settings-window">
      <aside className="settings-sidebar">
        <div className="settings-title">Settings</div>
        <nav aria-label="Settings sections">
          <button
            className={section === 'appearance' ? 'active' : ''}
            onClick={() => setSection('appearance')}
          >
            <Palette size={16} /> Appearance
          </button>
          <button
            className={section === 'vault' ? 'active' : ''}
            onClick={() => setSection('vault')}
          >
            <Cloud size={16} /> Vault & Backups
          </button>
          <button
            className={section === 'agents' ? 'active' : ''}
            onClick={() => setSection('agents')}
          >
            <Bot size={16} /> AI Agents
          </button>
        </nav>
      </aside>

      <section className="settings-content">
        <header>
          <h1>{section === 'appearance' ? 'Appearance' : section === 'vault' ? 'Vault & Backups' : 'AI Agents'}</h1>
          <p>
            {section === 'appearance'
              ? 'Choose how Folio looks across the workspace, editor, and preview.'
              : section === 'vault'
                ? 'Manage the one live vault, iCloud synchronization, and backups.'
                : 'Let local AI agents search, read, and safely work with your Folio vault.'}
          </p>
        </header>
        {section === 'appearance' ? (
          <AppearanceSettings
            value={themePreference}
            systemDark={systemDark}
            lineWrapping={lineWrapping}
            onSelect={selectTheme}
            onLineWrappingChange={(enabled) => {
              setLineWrapping(enabled)
              window.localStorage.setItem(LINE_WRAPPING_STORAGE_KEY, String(enabled))
              void window.folio.setLineWrappingPreference(enabled)
            }}
          />
        ) : section === 'agents' ? (
          <AgentSettings />
        ) : vaultInfo ? (
          <VaultSettings
            info={vaultInfo}
            onMove={async (storage) => {
              const result = await window.folio.moveVault(storage)
              setVaultInfo(result.info)
              return { canceled: result.canceled, safetyBackupPath: result.safetyBackupPath }
            }}
            onExport={async () => {
              const result = await window.folio.exportVaultBackup()
              setVaultInfo(result.info)
              return result.canceled ? undefined : result.path
            }}
            onRestore={async () => {
              const result = await window.folio.restoreVaultBackup()
              setVaultInfo(result.info)
              return result.canceled ? undefined : result.safetyBackupPath
            }}
            onShowInFinder={() => window.folio.showVaultInFinder()}
          />
        ) : (
          <div className="settings-loading">Loading vault information…</div>
        )}
      </section>
    </main>
  )
}
