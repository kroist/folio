export const themeIds = [
  'vscode-light',
  'vscode-dark',
  'light-modern',
  'dark-modern',
  'light-plus',
  'dark-plus',
  'visual-studio-light',
  'visual-studio-dark',
  'high-contrast-light',
  'high-contrast-dark',
] as const

export type ThemeId = (typeof themeIds)[number]
export type ThemePreference = 'system' | ThemeId

export interface ThemeDefinition {
  id: ThemeId
  name: string
  description: string
  scheme: 'light' | 'dark'
  preview: [string, string, string, string]
}

export const themes: ThemeDefinition[] = [
  {
    id: 'vscode-light',
    name: 'VS Code Light',
    description: 'The current VS Code light default',
    scheme: 'light',
    preview: ['#ffffff', '#fafafd', '#0069cc', '#202020'],
  },
  {
    id: 'vscode-dark',
    name: 'VS Code Dark',
    description: 'The current VS Code dark default',
    scheme: 'dark',
    preview: ['#121314', '#191a1b', '#3994bc', '#bbbebf'],
  },
  {
    id: 'light-modern',
    name: 'Light Modern',
    description: 'VS Code’s modern light palette',
    scheme: 'light',
    preview: ['#ffffff', '#f8f8f8', '#005fb8', '#3b3b3b'],
  },
  {
    id: 'dark-modern',
    name: 'Dark Modern',
    description: 'VS Code’s modern dark palette',
    scheme: 'dark',
    preview: ['#1f1f1f', '#181818', '#0078d4', '#cccccc'],
  },
  {
    id: 'light-plus',
    name: 'Light+',
    description: 'The familiar classic light theme',
    scheme: 'light',
    preview: ['#ffffff', '#f3f3f3', '#007acc', '#000000'],
  },
  {
    id: 'dark-plus',
    name: 'Dark+',
    description: 'The familiar classic dark theme',
    scheme: 'dark',
    preview: ['#1e1e1e', '#252526', '#007acc', '#d4d4d4'],
  },
  {
    id: 'visual-studio-light',
    name: 'Visual Studio Light',
    description: 'The original Visual Studio light colors',
    scheme: 'light',
    preview: ['#ffffff', '#f3f3f3', '#007acc', '#000000'],
  },
  {
    id: 'visual-studio-dark',
    name: 'Visual Studio Dark',
    description: 'The original Visual Studio dark colors',
    scheme: 'dark',
    preview: ['#1e1e1e', '#252526', '#007acc', '#d4d4d4'],
  },
  {
    id: 'high-contrast-light',
    name: 'High Contrast Light',
    description: 'Maximum contrast on a light canvas',
    scheme: 'light',
    preview: ['#ffffff', '#ffffff', '#0f4a85', '#292929'],
  },
  {
    id: 'high-contrast-dark',
    name: 'High Contrast Dark',
    description: 'Maximum contrast on a black canvas',
    scheme: 'dark',
    preview: ['#000000', '#000000', '#6fc3df', '#ffffff'],
  },
]

export const isThemePreference = (value: unknown): value is ThemePreference =>
  value === 'system' || themeIds.includes(value as ThemeId)

export const parseThemePreference = (value: string | null): ThemePreference =>
  isThemePreference(value) ? value : 'system'

export const resolveThemePreference = (
  preference: ThemePreference,
  systemDark: boolean,
): ThemeId => {
  if (preference === 'system') return systemDark ? 'vscode-dark' : 'vscode-light'
  return preference
}

export const themeScheme = (id: ThemeId): 'light' | 'dark' =>
  themes.find((theme) => theme.id === id)?.scheme ?? 'light'
