import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'highlight.js/styles/github-dark-dimmed.css'
import './styles.css'
import { App } from './App'
import { SettingsApp } from './SettingsApp'
import { parseThemePreference, resolveThemePreference, themeScheme } from './lib/themes'

const initialPreference = parseThemePreference(window.localStorage.getItem('folio.theme'))
const initialTheme = resolveThemePreference(
  initialPreference,
  window.matchMedia('(prefers-color-scheme: dark)').matches,
)
document.documentElement.dataset.theme = initialTheme
document.documentElement.style.colorScheme = themeScheme(initialTheme)

const RootComponent = new URLSearchParams(window.location.search).get('window') === 'settings'
  ? SettingsApp
  : App

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootComponent />
  </StrictMode>,
)
