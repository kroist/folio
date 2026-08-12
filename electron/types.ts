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

export type LibraryScope = 'all' | 'pinned' | string

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
