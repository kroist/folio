import { Check, Monitor, Moon, Sun } from 'lucide-react'
import { themes, type ThemePreference } from '../lib/themes'

interface AppearanceSettingsProps {
  value: ThemePreference
  systemDark: boolean
  lineWrapping: boolean
  onSelect: (theme: ThemePreference) => void
  onLineWrappingChange: (enabled: boolean) => void
}

export function AppearanceSettings({
  value,
  systemDark,
  lineWrapping,
  onSelect,
  onLineWrappingChange,
}: AppearanceSettingsProps) {
  return (
    <div className="appearance-settings">
      <section className="settings-group">
        <h2>Editor</h2>
        <label className="settings-toggle-row">
          <span>
            <strong>Wrap long lines</strong>
            <small>Keep text within the editor width instead of scrolling horizontally.</small>
          </span>
          <input
            type="checkbox"
            checked={lineWrapping}
            onChange={(event) => onLineWrappingChange(event.target.checked)}
          />
        </label>
      </section>

      <section className="settings-group">
        <h2>Theme</h2>
        <div className="settings-theme-grid">
          <button
            className={value === 'system' ? 'theme-card selected' : 'theme-card'}
            onClick={() => onSelect('system')}
          >
            <div className="theme-card-preview system-preview">
              <span style={{ background: '#ffffff' }} />
              <span style={{ background: '#121314' }} />
              <Monitor size={17} />
            </div>
            <span className="theme-card-copy">
              <strong>System</strong>
              <small>Follow macOS · currently {systemDark ? 'dark' : 'light'}</small>
            </span>
            {value === 'system' && <Check className="theme-check" size={15} />}
          </button>

          {themes.map((theme) => {
            const SchemeIcon = theme.scheme === 'dark' ? Moon : Sun
            return (
              <button
                className={value === theme.id ? 'theme-card selected' : 'theme-card'}
                key={theme.id}
                onClick={() => onSelect(theme.id)}
              >
                <div
                  className="theme-card-preview"
                  style={{ background: theme.preview[0], color: theme.preview[3] }}
                >
                  <span style={{ background: theme.preview[1] }} />
                  <i style={{ background: theme.preview[2] }} />
                  <b style={{ background: theme.preview[3] }} />
                  <SchemeIcon size={13} />
                </div>
                <span className="theme-card-copy">
                  <strong>{theme.name}</strong>
                  <small>{theme.description}</small>
                </span>
                {value === theme.id && <Check className="theme-check" size={15} />}
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}
