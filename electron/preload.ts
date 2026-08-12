import { contextBridge, ipcRenderer } from 'electron'
import type {
  CreateNoteInput,
  CreateNotebookInput,
  LibraryData,
  LibraryItemContextInput,
  McpConfigFormat,
  MoveNotebookInput,
  NoteUpdate,
  ReorderNotesInput,
  SearchInput,
  SearchStatus,
  SaveAttachmentInput,
  UpdateNotebookInput,
  VaultInfo,
} from './types'

contextBridge.exposeInMainWorld('folio', {
  listLibrary: () => ipcRenderer.invoke('library:list'),
  createNotebook: (input: CreateNotebookInput) => ipcRenderer.invoke('notebook:create', input),
  updateNotebook: (input: UpdateNotebookInput) => ipcRenderer.invoke('notebook:update', input),
  moveNotebook: (input: MoveNotebookInput) => ipcRenderer.invoke('notebook:move', input),
  deleteNotebook: (id: string) => ipcRenderer.invoke('notebook:delete', id),
  createNote: (input?: CreateNoteInput) => ipcRenderer.invoke('note:create', input),
  saveNote: (update: NoteUpdate) => ipcRenderer.invoke('note:save', update),
  deleteNote: (id: string) => ipcRenderer.invoke('note:delete', id),
  getNoteOrder: () => ipcRenderer.invoke('note-order:get'),
  reorderNotes: (input: ReorderNotesInput) => ipcRenderer.invoke('note:reorder', input),
  searchNotes: (input: SearchInput) => ipcRenderer.invoke('search:notes', input),
  onSearchStatus: (callback: (status: SearchStatus) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: SearchStatus) => callback(status)
    ipcRenderer.on('search:status', listener)
    return () => ipcRenderer.removeListener('search:status', listener)
  },
  getVaultInfo: () => ipcRenderer.invoke('vault:info'),
  moveVault: (storage: 'local' | 'icloud') => ipcRenderer.invoke('vault:move', storage),
  exportVaultBackup: () => ipcRenderer.invoke('vault:export-backup'),
  restoreVaultBackup: () => ipcRenderer.invoke('vault:restore-backup'),
  showVaultInFinder: () => ipcRenderer.invoke('vault:show-in-finder'),
  getMcpSetupInfo: () => ipcRenderer.invoke('mcp:setup-info'),
  copyMcpConfig: (format: McpConfigFormat) => ipcRenderer.invoke('mcp:copy-config', format),
  onLibraryChanged: (callback: (library: LibraryData) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, library: LibraryData) => callback(library)
    ipcRenderer.on('library:changed', listener)
    return () => ipcRenderer.removeListener('library:changed', listener)
  },
  showLibraryItemContextMenu: (input: LibraryItemContextInput) =>
    ipcRenderer.invoke('library-item:context-menu', input),
  saveAttachment: (input: SaveAttachmentInput) => ipcRenderer.invoke('attachment:save', input),
  readAttachmentDataUrl: (noteId: string, relativePath: string) =>
    ipcRenderer.invoke('attachment:read-data-url', noteId, relativePath),
  openSettings: (section: 'appearance' | 'vault' | 'agents' = 'appearance') =>
    ipcRenderer.invoke('settings:open', section),
  setThemePreference: (preference: string) => ipcRenderer.invoke('theme:set', preference),
  onThemePreference: (callback: (preference: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, preference: string) => callback(preference)
    ipcRenderer.on('theme:changed', listener)
    return () => ipcRenderer.removeListener('theme:changed', listener)
  },
  setLineWrappingPreference: (enabled: boolean) =>
    ipcRenderer.invoke('editor:line-wrapping:set', enabled),
  onLineWrappingPreference: (callback: (enabled: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, enabled: boolean) => callback(enabled)
    ipcRenderer.on('editor:line-wrapping:changed', listener)
    return () => ipcRenderer.removeListener('editor:line-wrapping:changed', listener)
  },
  onSettingsSection: (callback: (section: 'appearance' | 'vault' | 'agents') => void) => {
    const listener = (_event: Electron.IpcRendererEvent, section: 'appearance' | 'vault' | 'agents') => callback(section)
    ipcRenderer.on('settings:section', listener)
    return () => ipcRenderer.removeListener('settings:section', listener)
  },
  onVaultInfoChanged: (callback: (info: VaultInfo) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, info: VaultInfo) => callback(info)
    ipcRenderer.on('vault:changed', listener)
    return () => ipcRenderer.removeListener('vault:changed', listener)
  },
  onPrepareVaultOperation: (callback: () => Promise<void>) => {
    const listener = async (_event: Electron.IpcRendererEvent, id: number) => {
      try {
        await callback()
        ipcRenderer.send('vault:prepared', id)
      } catch (error) {
        ipcRenderer.send(
          'vault:prepared',
          id,
          error instanceof Error ? error.message : 'Could not save the current note',
        )
      }
    }
    ipcRenderer.on('vault:prepare', listener)
    return () => ipcRenderer.removeListener('vault:prepare', listener)
  },
})
