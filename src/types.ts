export interface Notebook {
  id: string
  name: string
  icon: string
  parentId?: string
}

export interface CreateNotebookInput {
  name: string
  icon: string
  parentId?: string
}

export interface UpdateNotebookInput {
  id: string
  name: string
  icon: string
}

export interface MoveNotebookInput {
  id: string
  parentId?: string
}

export interface Note {
  id: string
  notebookId: string
  title: string
  body: string
  tags: string[]
  pinned: boolean
  createdAt: string
  updatedAt: string
}

export interface NoteOrder {
  version: 1
  all: string[]
  pinned: string[]
  notebooks: Record<string, string[]>
}

export interface LibraryData {
  notebooks: Notebook[]
  notes: Note[]
  noteOrder: NoteOrder
}

export interface NoteUpdate {
  id: string
  title: string
  body: string
  notebookId: string
  tags: string[]
  pinned: boolean
}

export interface SaveNoteResult {
  note: Note
  linkedNotes: Note[]
  noteOrder: NoteOrder
}

export interface CreateNoteInput {
  notebookId?: string
  title?: string
}

export type NoteSort = 'manual' | 'updated' | 'created' | 'title'

export interface ReorderNotesInput {
  scope: LibraryScope
  noteId: string
  targetId: string
  placement: 'before' | 'after'
}

export type SearchMode = 'keyword' | 'semantic' | 'hybrid'

export interface SearchInput {
  query: string
  mode: SearchMode
  limit?: number
}

export interface NoteSearchResult {
  noteId: string
  score: number
  snippet: string
  source: SearchMode
}

export interface SearchStatus {
  state: 'idle' | 'indexing' | 'embedding' | 'searching' | 'ready' | 'error'
  semanticReady: boolean
  message?: string
  progress?: number
}

export interface VaultInfo {
  path: string
  storage: 'local' | 'icloud'
  iCloudAvailable: boolean
}

export interface VaultOperationResult {
  canceled: boolean
  info: VaultInfo
  library?: LibraryData
  path?: string
  safetyBackupPath?: string
}

export type McpConfigFormat = 'codex' | 'json'

export interface McpSetupInfo {
  vaultPath: string
  serverPath: string
  codexConfig: string
  jsonConfig: string
}

export interface LibraryItemContextInput {
  kind: 'note' | 'notebook'
  id: string
  pinned?: boolean
}

export type LibraryItemContextAction =
  | 'open'
  | 'new-note'
  | 'new-subnotebook'
  | 'rename'
  | 'toggle-pin'
  | 'delete'

export interface SaveAttachmentInput {
  noteId: string
  name: string
  mimeType: string
  data: Uint8Array
}

export interface SavedAttachment {
  relativePath: string
  mimeType: string
}

export type EditorMode = 'edit' | 'split' | 'preview'
export type LibraryScope = 'all' | 'pinned' | string
export interface DraggedLibraryItem {
  kind: 'note' | 'notebook'
  id: string
}

export interface FolioApi {
  listLibrary: () => Promise<LibraryData>
  createNotebook: (input: CreateNotebookInput) => Promise<Notebook>
  updateNotebook: (input: UpdateNotebookInput) => Promise<LibraryData>
  moveNotebook: (input: MoveNotebookInput) => Promise<LibraryData>
  deleteNotebook: (id: string) => Promise<LibraryData>
  createNote: (input?: CreateNoteInput) => Promise<Note>
  saveNote: (update: NoteUpdate) => Promise<SaveNoteResult>
  deleteNote: (id: string) => Promise<void>
  getNoteOrder: () => Promise<NoteOrder>
  reorderNotes: (input: ReorderNotesInput) => Promise<NoteOrder>
  searchNotes: (input: SearchInput) => Promise<NoteSearchResult[]>
  onSearchStatus: (callback: (status: SearchStatus) => void) => () => void
  getVaultInfo: () => Promise<VaultInfo>
  moveVault: (storage: 'local' | 'icloud') => Promise<VaultOperationResult>
  exportVaultBackup: () => Promise<VaultOperationResult>
  restoreVaultBackup: () => Promise<VaultOperationResult>
  showVaultInFinder: () => Promise<void>
  onLibraryChanged: (callback: (library: LibraryData) => void) => () => void
  showLibraryItemContextMenu: (
    input: LibraryItemContextInput,
  ) => Promise<LibraryItemContextAction | undefined>
  saveAttachment: (input: SaveAttachmentInput) => Promise<SavedAttachment>
  readAttachmentDataUrl: (noteId: string, relativePath: string) => Promise<string>
  getMcpSetupInfo: () => Promise<McpSetupInfo>
  copyMcpConfig: (format: McpConfigFormat) => Promise<void>
  openSettings: (section?: 'appearance' | 'vault' | 'agents') => Promise<void>
  setThemePreference: (preference: import('./lib/themes').ThemePreference) => Promise<void>
  onThemePreference: (
    callback: (preference: import('./lib/themes').ThemePreference) => void,
  ) => () => void
  setLineWrappingPreference: (enabled: boolean) => Promise<void>
  onLineWrappingPreference: (callback: (enabled: boolean) => void) => () => void
  onSettingsSection: (callback: (section: 'appearance' | 'vault' | 'agents') => void) => () => void
  onVaultInfoChanged: (callback: (info: VaultInfo) => void) => () => void
  onPrepareVaultOperation: (callback: () => Promise<void>) => () => void
}
