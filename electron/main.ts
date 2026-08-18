import { watch, type FSWatcher } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { app, autoUpdater, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } from 'electron'
import type { IpcMainInvokeEvent, MenuItemConstructorOptions } from 'electron'
import { QmdSearchService } from './search'
import { buildMcpSetupInfo } from './mcp-config'
import { LibraryStore } from './store'
import { createFolioUpdater, type FolioUpdater } from './updater'
import { VaultLocations } from './vault'
import type {
  CreateNoteInput,
  CreateNotebookInput,
  LibraryItemContextAction,
  LibraryItemContextInput,
  MoveNotebookInput,
  NoteUpdate,
  ReorderNotesInput,
  SaveAttachmentInput,
  SearchInput,
  UpdateNotebookInput,
} from './types'

let mainWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
let library: LibraryStore
let search: QmdSearchService
let vaultLocations: VaultLocations
let updater: FolioUpdater | undefined
let vaultWatcher: FSWatcher | null = null
let vaultRefreshTimer: NodeJS.Timeout | null = null
let ignoreVaultEventsUntil = 0
let prepareVaultRequestId = 0
const pendingVaultPreparation = new Map<number, {
  resolve: () => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}>()

const timestamp = (): string => new Date().toISOString().replace(/[:.]/g, '-').slice(0, -1)

const installDevelopmentDockIcon = (): void => {
  if (process.platform !== 'darwin' || app.isPackaged) return
  app.dock?.setIcon(path.join(__dirname, '../build/icon.png'))
}

const activeWindow = (): BrowserWindow => {
  if (!mainWindow) throw new Error('The Folio window is not available')
  return mainWindow
}

const windowForEvent = (event: IpcMainInvokeEvent): BrowserWindow =>
  BrowserWindow.fromWebContents(event.sender) ?? activeWindow()

const loadRenderer = async (
  window: BrowserWindow,
  query?: Record<string, string>,
): Promise<void> => {
  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  if (devServerUrl) {
    const url = new URL(devServerUrl)
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value)
    await window.loadURL(url.toString())
  } else {
    await window.loadFile(path.join(__dirname, '../dist/index.html'), { query })
  }
}

const secureWindowNavigation = (window: BrowserWindow): void => {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    const currentUrl = window.webContents.getURL()
    if (url !== currentUrl) {
      event.preventDefault()
      if (isAllowedExternalUrl(url)) void shell.openExternal(url)
    }
  })
}

const markLocalVaultMutation = async <T>(operation: () => Promise<T>): Promise<T> => {
  ignoreVaultEventsUntil = Date.now() + 1_500
  try {
    return await operation()
  } finally {
    ignoreVaultEventsUntil = Date.now() + 1_500
  }
}

const prepareMainEditor = async (): Promise<void> => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const id = ++prepareVaultRequestId
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingVaultPreparation.delete(id)
      reject(new Error('The editor did not finish saving. Please try again.'))
    }, 10_000)
    pendingVaultPreparation.set(id, { resolve, reject, timer })
    mainWindow!.webContents.send('vault:prepare', id)
  })
}

const notifyVaultChanged = async (): Promise<void> => {
  const [info, data] = await Promise.all([
    vaultLocations.info(library.getVaultPath()),
    library.list(),
  ])
  mainWindow?.webContents.send('library:changed', data)
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('vault:changed', info)
  }
}

const createSearchService = (): QmdSearchService =>
  new QmdSearchService(
    library.getVaultPath(),
    vaultLocations.searchIndexPath,
    path.join(__dirname, 'qmd-worker.cjs'),
    (status) => mainWindow?.webContents.send('search:status', status),
    app.isPackaged ? path.join(process.resourcesPath, 'runtime', 'node') : 'node',
  )

const stopVaultWatcher = (): void => {
  if (vaultRefreshTimer) clearTimeout(vaultRefreshTimer)
  vaultRefreshTimer = null
  vaultWatcher?.close()
  vaultWatcher = null
}

const startVaultWatcher = (): void => {
  stopVaultWatcher()
  try {
    vaultWatcher = watch(library.getVaultPath(), { recursive: true }, (_eventType, filename) => {
      if (Date.now() < ignoreVaultEventsUntil) return
      if (filename && /^\.folio[/\\]qmd-index\.sqlite/.test(filename)) return
      if (vaultRefreshTimer) clearTimeout(vaultRefreshTimer)
      vaultRefreshTimer = setTimeout(() => {
        vaultRefreshTimer = null
        void library.reload().then((data) => {
          search.markDirty()
          mainWindow?.webContents.send('library:changed', data)
        }).catch((error: unknown) => {
          console.warn('Could not reload externally changed vault.', error)
        })
      }, 700)
    })
    vaultWatcher.on('error', (error) => console.warn('Vault watcher stopped.', error))
  } catch (error) {
    console.warn('Could not watch the vault for external changes.', error)
  }
}

const isAllowedExternalUrl = (rawUrl: string): boolean => {
  try {
    const url = new URL(rawUrl)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

const createWindow = async (): Promise<void> => {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#f7f5f0',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  secureWindowNavigation(mainWindow)
  await loadRenderer(mainWindow)
}

const openSettingsWindow = async (
  section: 'appearance' | 'vault' | 'agents' = 'appearance',
): Promise<void> => {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('settings:section', section)
    if (settingsWindow.isMinimized()) settingsWindow.restore()
    settingsWindow.show()
    settingsWindow.focus()
    return
  }

  settingsWindow = new BrowserWindow({
    width: 720,
    height: 570,
    minWidth: 640,
    minHeight: 500,
    maxWidth: 900,
    title: 'Folio Settings',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 15 },
    backgroundColor: '#f7f5f0',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  settingsWindow.setMenuBarVisibility(false)
  settingsWindow.once('ready-to-show', () => settingsWindow?.show())
  settingsWindow.on('closed', () => {
    settingsWindow = null
  })
  secureWindowNavigation(settingsWindow)
  await loadRenderer(settingsWindow, { window: 'settings', section })
}

const installApplicationMenu = (): void => {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Folio',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Check for Updates…',
          click: () => updater?.checkForUpdates(true),
        },
        { type: 'separator' },
        {
          label: 'Settings…',
          accelerator: 'CommandOrControl+,',
          click: () => void openSettingsWindow('appearance'),
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(async () => {
  installDevelopmentDockIcon()
  const userDataPath = app.getPath('userData')
  vaultLocations = new VaultLocations(userDataPath, app.getPath('home'))
  const vaultPath = await vaultLocations.readVaultPath()
  library = new LibraryStore(userDataPath, vaultPath)
  await library.list()
  await vaultLocations.migrateLegacySearchIndex(vaultPath)
  search = createSearchService()
  startVaultWatcher()
  updater = createFolioUpdater({
    autoUpdater,
    dialog,
    getWindow: () => mainWindow,
    prepareToRestart: prepareMainEditor,
    isPackaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
    version: app.getVersion(),
  })
  installApplicationMenu()

  ipcMain.on('vault:prepared', (event, id: number, error?: string) => {
    if (event.sender !== mainWindow?.webContents) return
    const pending = pendingVaultPreparation.get(id)
    if (!pending) return
    clearTimeout(pending.timer)
    pendingVaultPreparation.delete(id)
    if (error) pending.reject(new Error(error))
    else pending.resolve()
  })
  ipcMain.handle('settings:open', (_event, section: 'appearance' | 'vault' | 'agents') => {
    if (!['appearance', 'vault', 'agents'].includes(section)) throw new Error('Invalid settings section')
    return openSettingsWindow(section)
  })
  const mcpSetupInfo = () => buildMcpSetupInfo({
    executablePath: process.execPath,
    serverPath: path.join(__dirname, 'mcp-server.cjs'),
    vaultPath: library.getVaultPath(),
    userDataPath,
    qmdWorkerPath: path.join(__dirname, 'qmd-worker.cjs'),
    searchIndexPath: vaultLocations.mcpSearchIndexPath,
    nodeRuntimePath: app.isPackaged
      ? path.join(process.resourcesPath, 'runtime', 'node')
      : process.execPath,
  })
  ipcMain.handle('mcp:setup-info', () => mcpSetupInfo())
  ipcMain.handle('mcp:copy-config', (_event, format: 'codex' | 'json') => {
    if (format !== 'codex' && format !== 'json') throw new Error('Invalid MCP config format')
    const setup = mcpSetupInfo()
    clipboard.writeText(format === 'codex' ? setup.codexConfig : setup.jsonConfig)
  })
  ipcMain.handle('theme:set', (_event, preference: string) => {
    const allowed = new Set([
      'system', 'vscode-light', 'vscode-dark', 'light-modern', 'dark-modern',
      'light-plus', 'dark-plus', 'visual-studio-light', 'visual-studio-dark',
      'high-contrast-light', 'high-contrast-dark',
    ])
    if (!allowed.has(preference)) throw new Error('Invalid theme')
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('theme:changed', preference)
    }
  })
  ipcMain.handle('editor:line-wrapping:set', (_event, enabled: boolean) => {
    if (typeof enabled !== 'boolean') throw new Error('Invalid line wrapping preference')
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('editor:line-wrapping:changed', enabled)
    }
  })

  ipcMain.handle('library:list', () => library.list())
  ipcMain.handle('attachment:save', (_event, input: SaveAttachmentInput) =>
    markLocalVaultMutation(() => library.saveAttachment(input)))
  ipcMain.handle('attachment:read-data-url', (_event, noteId: string, relativePath: string) =>
    library.readAttachmentDataUrl(noteId, relativePath))
  ipcMain.handle(
    'library-item:context-menu',
    async (event, input: LibraryItemContextInput): Promise<LibraryItemContextAction | undefined> => {
      if (
        !input ||
        (input.kind !== 'note' && input.kind !== 'notebook') ||
        typeof input.id !== 'string' ||
        input.id.length === 0 ||
        input.id.length > 100
      ) {
        throw new Error('Invalid library item')
      }
      const itemPath = await library.itemPath(input.kind, input.id)
      return new Promise((resolve) => {
        let selectedAction: LibraryItemContextAction | undefined
        const choose = (action: LibraryItemContextAction) => () => {
          selectedAction = action
        }
        const sharedItems: MenuItemConstructorOptions[] = [
          { type: 'separator' },
          {
            label: 'Copy Unique Path',
            click: () => clipboard.writeText(itemPath.relativePath),
          },
          {
            label: 'Show in Finder',
            click: () => shell.showItemInFolder(itemPath.absolutePath),
          },
          { type: 'separator' },
        ]
        const template: MenuItemConstructorOptions[] = input.kind === 'note'
          ? [
              { label: 'Open', click: choose('open') },
              {
                label: 'Copy Link',
                click: () => clipboard.writeText(`[[${itemPath.relativePath}]]`),
              },
              ...sharedItems,
              { label: input.pinned ? 'Unpin Note' : 'Pin Note', click: choose('toggle-pin') },
              { label: 'Delete Note…', click: choose('delete') },
            ]
          : [
              { label: 'New Note', click: choose('new-note') },
              { label: 'New Sub-notebook…', click: choose('new-subnotebook') },
              { label: 'Rename and Icon…', click: choose('rename') },
              ...sharedItems,
              { label: 'Delete Notebook…', click: choose('delete') },
            ]
        Menu.buildFromTemplate(template).popup({
          window: windowForEvent(event),
          callback: () => resolve(selectedAction),
        })
      })
    },
  )
  ipcMain.handle('notebook:create', async (_event, input: CreateNotebookInput) => {
    const notebook = await markLocalVaultMutation(() => library.createNotebook(input))
    search.markDirty()
    return notebook
  })
  ipcMain.handle('notebook:update', async (_event, input: UpdateNotebookInput) => {
    const data = await markLocalVaultMutation(() => library.updateNotebook(input))
    search.markDirty()
    return data
  })
  ipcMain.handle('notebook:move', async (_event, input: MoveNotebookInput) => {
    const data = await markLocalVaultMutation(() => library.moveNotebook(input))
    search.markDirty()
    return data
  })
  ipcMain.handle('notebook:delete', async (_event, id: string) => {
    const data = await markLocalVaultMutation(() => library.deleteNotebook(id))
    search.markDirty()
    return data
  })
  ipcMain.handle('note:create', async (_event, input?: CreateNoteInput) => {
    const note = await markLocalVaultMutation(() => library.create(input))
    search.markDirty()
    return note
  })
  ipcMain.handle('note:save', async (_event, update: NoteUpdate) => {
    const note = await markLocalVaultMutation(() => library.save(update))
    search.markDirty()
    return note
  })
  ipcMain.handle('note:delete', async (_event, id: string) => {
    await markLocalVaultMutation(() => library.delete(id))
    search.markDirty()
  })
  ipcMain.handle('note:reorder', async (_event, input: ReorderNotesInput) =>
    markLocalVaultMutation(() => library.reorderNotes(input)),
  )
  ipcMain.handle('note-order:get', () => library.getNoteOrder())
  ipcMain.handle('search:notes', (_event, input: SearchInput) => {
    if (
      !input ||
      typeof input.query !== 'string' ||
      input.query.length > 1_000 ||
      !['keyword', 'semantic', 'hybrid'].includes(input.mode)
    ) {
      throw new Error('Invalid search request')
    }
    return search.search(input)
  })
  ipcMain.handle('vault:info', () => vaultLocations.info(library.getVaultPath()))
  ipcMain.handle('vault:move', async (event, storage: 'local' | 'icloud') => {
    if (storage !== 'local' && storage !== 'icloud') throw new Error('Invalid vault location')
    const currentInfo = await vaultLocations.info(library.getVaultPath())
    if (currentInfo.storage === storage) {
      return { canceled: false, info: currentInfo, library: await library.list() }
    }
    if (storage === 'icloud' && !currentInfo.iCloudAvailable) {
      throw new Error('iCloud Drive is not available. Enable it in macOS System Settings first.')
    }

    const destination = storage === 'icloud' ? vaultLocations.iCloudPath : vaultLocations.localPath
    const destinationExists = await vaultLocations.pathExists(destination)
    let safetyBackupPath: string | undefined
    if (destinationExists) {
      const confirmation = await dialog.showMessageBox(windowForEvent(event), {
        type: 'question',
        title: `Use the existing ${storage === 'icloud' ? 'iCloud' : 'local'} vault?`,
        message: `A Folio vault already exists ${storage === 'icloud' ? 'in iCloud Drive' : 'on this Mac'}.`,
        detail: 'Folio can switch to it and preserve the current vault as a safety backup. Vaults will not be merged.',
        buttons: ['Cancel', 'Use Existing Vault'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      })
      if (confirmation.response !== 1) {
        return { canceled: true, info: currentInfo, library: await library.list() }
      }
      await mkdir(vaultLocations.restoreBackupsPath, { recursive: true })
      safetyBackupPath = path.join(
        vaultLocations.restoreBackupsPath,
        `Folio Before Vault Switch ${timestamp()}`,
      )
    }
    await prepareMainEditor()
    stopVaultWatcher()
    await search.close()
    try {
      if (destinationExists && safetyBackupPath) {
        safetyBackupPath = await library.adoptVault(destination, safetyBackupPath)
      } else {
        await library.moveVault(destination)
      }
      await vaultLocations.writeVaultPath(destination)
      await vaultLocations.migrateLegacySearchIndex(destination)
    } finally {
      search = createSearchService()
      startVaultWatcher()
    }
    const result = {
      canceled: false,
      info: await vaultLocations.info(library.getVaultPath()),
      library: await library.list(),
      safetyBackupPath,
    }
    await notifyVaultChanged()
    return result
  })
  ipcMain.handle('vault:export-backup', async (event) => {
    await prepareMainEditor()
    const selection = await dialog.showOpenDialog(windowForEvent(event), {
      title: 'Choose where to save the Folio backup',
      buttonLabel: 'Export Here',
      defaultPath: app.getPath('documents'),
      properties: ['openDirectory', 'createDirectory'],
    })
    if (selection.canceled || !selection.filePaths[0]) {
      return { canceled: true, info: await vaultLocations.info(library.getVaultPath()) }
    }
    const backupPath = path.join(selection.filePaths[0], `Folio Backup ${timestamp()}`)
    await library.exportBackup(backupPath)
    return {
      canceled: false,
      info: await vaultLocations.info(library.getVaultPath()),
      path: backupPath,
    }
  })
  ipcMain.handle('vault:restore-backup', async (event) => {
    const selection = await dialog.showOpenDialog(windowForEvent(event), {
      title: 'Choose a Folio backup',
      buttonLabel: 'Choose Backup',
      defaultPath: app.getPath('documents'),
      properties: ['openDirectory'],
    })
    if (selection.canceled || !selection.filePaths[0]) {
      return { canceled: true, info: await vaultLocations.info(library.getVaultPath()) }
    }
    const confirmation = await dialog.showMessageBox(windowForEvent(event), {
      type: 'warning',
      title: 'Restore Folio backup?',
      message: 'Restore this backup and replace the current vault?',
      detail: 'Folio will save a safety copy of the current vault before restoring.',
      buttons: ['Cancel', 'Restore Backup'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    })
    if (confirmation.response !== 1) {
      return { canceled: true, info: await vaultLocations.info(library.getVaultPath()) }
    }

    await prepareMainEditor()
    await mkdir(vaultLocations.restoreBackupsPath, { recursive: true })
    const requestedSafetyBackupPath = path.join(
      vaultLocations.restoreBackupsPath,
      `Folio Before Restore ${timestamp()}`,
    )
    stopVaultWatcher()
    await search.close()
    let safetyBackupPath = requestedSafetyBackupPath
    try {
      safetyBackupPath = await library.restoreBackup(
        selection.filePaths[0],
        requestedSafetyBackupPath,
      )
    } finally {
      search = createSearchService()
      startVaultWatcher()
    }
    const data = await library.list()
    const result = {
      canceled: false,
      info: await vaultLocations.info(library.getVaultPath()),
      library: data,
      safetyBackupPath,
    }
    await notifyVaultChanged()
    return result
  })
  ipcMain.handle('vault:show-in-finder', async () => {
    const error = await shell.openPath(library.getVaultPath())
    if (error) throw new Error(error)
  })

  await createWindow()
  updater.start()

  app.on('activate', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) await createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  updater?.stop()
  stopVaultWatcher()
  void search?.close()
})
