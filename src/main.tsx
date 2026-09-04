import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'highlight.js/styles/github-dark-dimmed.css'
import 'katex/dist/katex.min.css'
import './styles.css'
import { App } from './App'
import { ExportApp } from './ExportApp'
import { SettingsApp } from './SettingsApp'
import { parseThemePreference, resolveThemePreference, themeScheme } from './lib/themes'

const windowKind = new URLSearchParams(window.location.search).get('window')
if (windowKind === 'export') {
  document.documentElement.classList.add('export-window')
  document.documentElement.style.colorScheme = 'light'
} else {
  const initialPreference = parseThemePreference(window.localStorage.getItem('folio.theme'))
  const initialTheme = resolveThemePreference(
    initialPreference,
    window.matchMedia('(prefers-color-scheme: dark)').matches,
  )
  document.documentElement.dataset.theme = initialTheme
  document.documentElement.style.colorScheme = themeScheme(initialTheme)
}

const RootComponent = windowKind === 'settings'
  ? SettingsApp
  : windowKind === 'export' ? ExportApp : App

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootComponent />
  </StrictMode>,
)
