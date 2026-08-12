import { randomUUID } from 'node:crypto'
import { access, cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  CreateNoteInput,
  CreateNotebookInput,
  LibraryData,
  MoveNotebookInput,
  Note,
  NoteOrder,
  Notebook,
  NoteUpdate,
  ReorderNotesInput,
  SaveAttachmentInput,
  SavedAttachment,
  SaveNoteResult,
  UpdateNotebookInput,
} from './types'
import {
  legacyNoteWikiLinkTarget,
  normalizeWikiLinkTarget,
  noteWikiLinkTarget,
  rewriteWikiLinkTargets,
} from './wiki-links'

const VAULT_VERSION = 1
const MARKDOWN_EXTENSION = '.md'
const NOTEBOOK_ICONS = new Set([
  'archive',
  'book-open',
  'bookmark',
  'briefcase',
  'code',
  'folder',
  'home',
  'lightbulb',
  'star',
])

const IMAGE_EXTENSIONS = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/gif', '.gif'],
  ['image/webp', '.webp'],
  ['image/avif', '.avif'],
])
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

interface VaultMetadata {
  version: number
  notebooks: Notebook[]
}

const NOTE_ORDER_VERSION = 1 as const

const noteIdsByRecency = (notes: Note[]): string[] =>
  [...notes]
    .sort((left, right) => {
      if (left.pinned !== right.pinned) return left.pinned ? -1 : 1
      return Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
    })
    .map((note) => note.id)

const notebookDescendantIds = (notebooks: Notebook[], id: string): Set<string> => {
  const ids = new Set<string>([id])
  let changed = true
  while (changed) {
    changed = false
    for (const notebook of notebooks) {
      if (notebook.parentId && ids.has(notebook.parentId) && !ids.has(notebook.id)) {
        ids.add(notebook.id)
        changed = true
      }
    }
  }
  return ids
}

const reconcileSequence = (sequence: string[] | undefined, eligibleIds: string[]): string[] => {
  const eligible = new Set(eligibleIds)
  const seen = new Set<string>()
  const existing = (sequence ?? []).filter((id) => {
    if (!eligible.has(id) || seen.has(id)) return false
    seen.add(id)
    return true
  })
  const missing = eligibleIds.filter((id) => !seen.has(id))
  return [...missing, ...existing]
}

const reconcileNoteOrder = (
  order: Partial<NoteOrder> | undefined,
  notes: Note[],
  notebooks: Notebook[],
): NoteOrder => {
  const defaultIds = noteIdsByRecency(notes)
  const notesById = new Map(notes.map((note) => [note.id, note]))
  const pinnedIds = defaultIds.filter((id) => notesById.get(id)?.pinned)
  const notebookOrder: Record<string, string[]> = {}
  for (const notebook of notebooks) {
    const descendants = notebookDescendantIds(notebooks, notebook.id)
    const eligibleIds = defaultIds.filter((id) => {
      const note = notesById.get(id)
      return note ? descendants.has(note.notebookId) : false
    })
    notebookOrder[notebook.id] = reconcileSequence(order?.notebooks?.[notebook.id], eligibleIds)
  }
  return {
    version: NOTE_ORDER_VERSION,
    all: reconcileSequence(order?.all, defaultIds),
    pinned: reconcileSequence(order?.pinned, pinnedIds),
    notebooks: notebookOrder,
  }
}

const starterData = (): LibraryData => {
  const now = new Date().toISOString()

  const notebooks: Notebook[] = [
      { id: 'personal', name: 'Personal', icon: 'home' },
      { id: 'projects', name: 'Projects', icon: 'folder' },
      { id: 'reading', name: 'Reading', icon: 'book-open' },
    ]
  const notes: Note[] = [
      {
        id: randomUUID(),
        notebookId: 'personal',
        title: 'Welcome to Folio',
        body: `# Welcome to Folio

This is your quiet place for **notes, ideas, and work in progress**.

## A local-first workspace

Everything is stored on this Mac. Start writing in the editor, switch to preview, or keep both side by side.

- Press **⌘N** to create a note
- Press **⌘K** to search
- Use the mode control above to edit or preview

> The first version is intentionally small: a dependable writing loop before everything else.

\`\`\`ts
const idea = 'Make the simple thing feel excellent'
\`\`\`
`,
        tags: ['welcome', 'guide'],
        pinned: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: randomUUID(),
        notebookId: 'projects',
        title: 'Markdown editor roadmap',
        body: `# Markdown editor roadmap

## Foundation

- [x] Three-pane desktop shell
- [x] Local notes and autosave
- [x] Edit, split, and preview modes
- [ ] Internal links
- [ ] Command palette
- [ ] Templates

## Principle

Keep the renderer away from the input-critical path and make every visible action available from the keyboard.
`,
        tags: ['project'],
        pinned: false,
        createdAt: now,
        updatedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      },
    ]
  return {
    notebooks,
    notes,
    noteOrder: reconcileNoteOrder(undefined, notes, notebooks),
  }
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

const isNotebook = (value: unknown): value is Notebook => {
  if (!value || typeof value !== 'object') return false
  const notebook = value as Record<string, unknown>
  return (
    typeof notebook.id === 'string' &&
    typeof notebook.name === 'string' &&
    typeof notebook.icon === 'string' &&
    (notebook.parentId === undefined || typeof notebook.parentId === 'string')
  )
}

const safeFileName = (value: string, fallback: string): string => {
  const printableValue = [...value.normalize('NFC')]
    .map((character) => (character.charCodeAt(0) < 32 ? '-' : character))
    .join('')
  const sanitized = printableValue
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 120)
  return sanitized || fallback
}

const serializeNote = (note: Note): string =>
  [
    '---',
    `id: ${JSON.stringify(note.id)}`,
    `title: ${JSON.stringify(note.title)}`,
    `notebookId: ${JSON.stringify(note.notebookId)}`,
    `tags: ${JSON.stringify(note.tags)}`,
    `pinned: ${JSON.stringify(note.pinned)}`,
    `createdAt: ${JSON.stringify(note.createdAt)}`,
    `updatedAt: ${JSON.stringify(note.updatedAt)}`,
    '---',
    note.body,
  ].join('\n')

const parseScalar = (value: string): unknown => {
  try {
    return JSON.parse(value)
  } catch {
    return value.trim()
  }
}

export const parseNoteFile = (
  content: string,
  fallbackTitle = 'Untitled note',
  fallbackNotebookId = 'personal',
): Note => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)
  if (!match) throw new Error('Missing Folio frontmatter')

  const metadata = new Map<string, unknown>()
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':')
    if (separator < 1) continue
    metadata.set(line.slice(0, separator).trim(), parseScalar(line.slice(separator + 1).trim()))
  }

  const id = metadata.get('id')
  if (typeof id !== 'string' || id.length === 0 || id.length > 100) {
    throw new Error('Invalid note id')
  }

  const title = metadata.get('title')
  const notebookId = metadata.get('notebookId')
  const tags = metadata.get('tags')
  const pinned = metadata.get('pinned')
  const createdAt = metadata.get('createdAt')
  const updatedAt = metadata.get('updatedAt')
  const now = new Date().toISOString()

  return {
    id,
    title: typeof title === 'string' && title.trim() ? title : fallbackTitle,
    notebookId:
      typeof notebookId === 'string' && notebookId ? notebookId : fallbackNotebookId,
    tags: isStringArray(tags) ? tags : [],
    pinned: typeof pinned === 'boolean' ? pinned : false,
    createdAt: typeof createdAt === 'string' ? createdAt : now,
    updatedAt: typeof updatedAt === 'string' ? updatedAt : now,
    body: content.slice(match[0].length),
  }
}

const readMarkdownFiles = async (directory: string): Promise<string[]> => {
  const files: string[] = []
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === '.folio') continue
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await readMarkdownFiles(entryPath)))
    } else if (entry.isFile() && path.extname(entry.name).toLocaleLowerCase() === MARKDOWN_EXTENSION) {
      files.push(entryPath)
    }
  }
  return files
}

const atomicWrite = async (filePath: string, content: string): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.tmp`
  await writeFile(temporaryPath, content, 'utf8')
  await rename(temporaryPath, filePath)
}

export class LibraryStore {
  private readonly legacyFilePath: string
  private vaultPath: string
  private metadataPath: string
  private noteOrderPath: string
  private trashPath: string
  private data: LibraryData | null = null
  private loadPromise: Promise<void> | null = null
  private operationQueue = Promise.resolve()
  private readonly notePaths = new Map<string, string>()

  constructor(userDataPath: string, vaultPath = path.join(userDataPath, 'vault')) {
    this.legacyFilePath = path.join(userDataPath, 'library.json')
    this.vaultPath = vaultPath
    this.metadataPath = ''
    this.noteOrderPath = ''
    this.trashPath = ''
    this.setVaultPath(vaultPath)
  }

  getVaultPath(): string {
    return this.vaultPath
  }

  async list(): Promise<LibraryData> {
    await this.ensureLoaded()
    await this.operationQueue
    return structuredClone(this.data as LibraryData)
  }

  async getNoteOrder(): Promise<NoteOrder> {
    await this.ensureLoaded()
    await this.operationQueue
    return structuredClone(this.data!.noteOrder)
  }

  async reorderNotes(input: ReorderNotesInput): Promise<NoteOrder> {
    await this.ensureLoaded()
    return this.enqueue(async () => {
      if (
        !input ||
        typeof input.scope !== 'string' ||
        input.scope.length > 100 ||
        typeof input.noteId !== 'string' ||
        input.noteId.length > 100 ||
        typeof input.targetId !== 'string' ||
        input.targetId.length > 100 ||
        (input.placement !== 'before' && input.placement !== 'after')
      ) {
        throw new Error('Invalid note reorder request')
      }

      const eligibleIds = this.noteIdsForScope(input.scope)
      if (!eligibleIds.includes(input.noteId) || !eligibleIds.includes(input.targetId)) {
        throw new Error('A note is not part of this list')
      }
      if (input.noteId === input.targetId) return structuredClone(this.data!.noteOrder)

      const sequence = reconcileSequence(this.noteOrderForScope(input.scope), eligibleIds)
        .filter((id) => id !== input.noteId)
      const targetIndex = sequence.indexOf(input.targetId)
      if (targetIndex < 0) throw new Error('Drop target not found')
      sequence.splice(targetIndex + (input.placement === 'after' ? 1 : 0), 0, input.noteId)
      this.setNoteOrderForScope(input.scope, sequence)
      await this.writeNoteOrder()
      return structuredClone(this.data!.noteOrder)
    })
  }

  async itemPath(
    kind: 'note' | 'notebook',
    id: string,
  ): Promise<{ absolutePath: string; relativePath: string }> {
    await this.ensureLoaded()
    await this.operationQueue
    let absolutePath: string | undefined
    if (kind === 'note') {
      absolutePath = this.notePaths.get(id)
    } else {
      const notebook = this.data!.notebooks.find((item) => item.id === id)
      if (notebook) absolutePath = this.pathForNotebook(notebook.id)
    }
    if (!absolutePath) throw new Error(`${kind === 'note' ? 'Note' : 'Notebook'} not found`)
    return {
      absolutePath,
      relativePath: path.relative(this.vaultPath, absolutePath).split(path.sep).join('/'),
    }
  }

  async saveAttachment(input: SaveAttachmentInput): Promise<SavedAttachment> {
    await this.ensureLoaded()
    return this.enqueue(async () => {
      if (!input || typeof input.noteId !== 'string' || input.noteId.length > 100) {
        throw new Error('Invalid note id')
      }
      const notePath = this.notePaths.get(input.noteId)
      if (!notePath) throw new Error('Note not found')
      const extension = IMAGE_EXTENSIONS.get(input.mimeType)
      if (!extension) throw new Error('Unsupported image type')
      if (!(input.data instanceof Uint8Array) || input.data.byteLength === 0) {
        throw new Error('The image is empty')
      }
      if (input.data.byteLength > MAX_ATTACHMENT_BYTES) {
        throw new Error('Images must be smaller than 25 MB')
      }

      const originalBase = path.basename(input.name, path.extname(input.name))
      const baseName = safeFileName(originalBase, 'image')
        .replace(/[()[\]]/g, '-')
        .replace(/\s+/g, '-')
      const fileName = `${baseName}-${randomUUID().slice(0, 8)}${extension}`
      const directory = this.attachmentDirectory(input.noteId, notePath)
      const absolutePath = path.join(directory, fileName)
      await mkdir(directory, { recursive: true })
      await writeFile(absolutePath, input.data)
      return {
        relativePath: path.posix.join(
          '.attachments',
          safeFileName(input.noteId, 'note'),
          fileName,
        ),
        mimeType: input.mimeType,
      }
    })
  }

  async readAttachmentDataUrl(noteId: string, relativePath: string): Promise<string> {
    await this.ensureLoaded()
    await this.operationQueue
    const notePath = this.notePaths.get(noteId)
    if (!notePath) throw new Error('Note not found')
    const expectedPrefix = `${path.posix.join(
      '.attachments',
      safeFileName(noteId, 'note'),
    )}/`
    const normalized = relativePath.replaceAll('\\', '/')
    if (!normalized.startsWith(expectedPrefix) || normalized.includes('..')) {
      throw new Error('Invalid attachment path')
    }
    const fileName = path.posix.basename(normalized)
    const extension = path.extname(fileName).toLocaleLowerCase()
    const mimeType = [...IMAGE_EXTENSIONS].find(([, value]) => value === extension)?.[0]
    if (!mimeType) throw new Error('Unsupported image type')
    const directory = this.attachmentDirectory(noteId, notePath)
    const absolutePath = path.resolve(directory, fileName)
    if (path.dirname(absolutePath) !== path.resolve(directory)) {
      throw new Error('Invalid attachment path')
    }
    const content = await readFile(absolutePath)
    return `data:${mimeType};base64,${content.toString('base64')}`
  }

  async reload(): Promise<LibraryData> {
    return this.enqueue(async () => {
      this.data = null
      this.loadPromise = null
      this.notePaths.clear()
      await this.ensureLoaded()
      if (!this.data) throw new Error('Could not reload the vault')
      return structuredClone(this.data)
    })
  }

  async moveVault(nextVaultPath: string): Promise<void> {
    await this.ensureLoaded()
    await this.operationQueue
    const resolvedPath = path.resolve(nextVaultPath)
    if (resolvedPath === this.vaultPath) return
    if (resolvedPath === path.parse(resolvedPath).root) throw new Error('Invalid vault location')
    try {
      await readdir(resolvedPath)
      throw new Error('A Folio vault already exists at that location')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }

    await mkdir(path.dirname(resolvedPath), { recursive: true })
    try {
      await rename(this.vaultPath, resolvedPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
      await cp(this.vaultPath, resolvedPath, { recursive: true, errorOnExist: true })
      await readFile(path.join(resolvedPath, '.folio', 'library.json'), 'utf8')
      await rm(this.vaultPath, { recursive: true })
    }

    const previousPath = this.vaultPath
    this.setVaultPath(resolvedPath)
    this.replaceNotePathPrefix(previousPath, resolvedPath)
  }

  async adoptVault(nextVaultPath: string, safetyBackupPath: string): Promise<string> {
    await this.ensureLoaded()
    await this.operationQueue
    const resolvedPath = path.resolve(nextVaultPath)
    if (resolvedPath === this.vaultPath) return this.vaultPath
    await this.validateVaultDirectory(resolvedPath)

    const previousVaultPath = this.vaultPath
    this.setVaultPath(resolvedPath)
    this.data = null
    this.loadPromise = null
    this.notePaths.clear()
    try {
      await this.ensureLoaded()
    } catch (error) {
      this.setVaultPath(previousVaultPath)
      this.data = null
      this.loadPromise = null
      this.notePaths.clear()
      await this.ensureLoaded()
      throw error
    }

    try {
      await cp(previousVaultPath, safetyBackupPath, { recursive: true, errorOnExist: true })
      await rm(previousVaultPath, { recursive: true })
      return safetyBackupPath
    } catch (error) {
      console.warn(`The previous vault remains at ${previousVaultPath}`, error)
      return previousVaultPath
    }
  }

  async exportBackup(destinationPath: string): Promise<void> {
    await this.ensureLoaded()
    await this.operationQueue
    await cp(this.vaultPath, destinationPath, {
      recursive: true,
      errorOnExist: true,
      filter: (source) => !/^qmd-index\.sqlite(?:-(?:shm|wal))?$/.test(path.basename(source)),
    })
  }

  async restoreBackup(sourcePath: string, safetyBackupPath: string): Promise<string> {
    await this.ensureLoaded()
    await this.operationQueue
    const resolvedSource = path.resolve(sourcePath)
    if (resolvedSource === this.vaultPath) throw new Error('That folder is the current vault')
    await this.validateVaultDirectory(resolvedSource)

    const parentPath = path.dirname(this.vaultPath)
    const token = randomUUID()
    const stagedPath = path.join(parentPath, `.folio-restore-${token}`)
    const previousPath = path.join(parentPath, `.folio-before-restore-${token}`)
    await cp(resolvedSource, stagedPath, { recursive: true, errorOnExist: true })
    await this.validateVaultDirectory(stagedPath)
    await rename(this.vaultPath, previousPath)
    try {
      await rename(stagedPath, this.vaultPath)
    } catch (error) {
      await rename(previousPath, this.vaultPath)
      throw error
    }

    this.data = null
    this.loadPromise = null
    this.notePaths.clear()
    try {
      await this.ensureLoaded()
    } catch (error) {
      await rm(this.vaultPath, { recursive: true })
      await rename(previousPath, this.vaultPath)
      this.data = null
      this.loadPromise = null
      this.notePaths.clear()
      await this.ensureLoaded()
      throw error
    }

    try {
      await cp(previousPath, safetyBackupPath, { recursive: true, errorOnExist: true })
      await rm(previousPath, { recursive: true })
      return safetyBackupPath
    } catch (error) {
      console.warn(`The pre-restore vault remains at ${previousPath}`, error)
      return previousPath
    }
  }

  async createNotebook(input: CreateNotebookInput): Promise<Notebook> {
    await this.ensureLoaded()
    return this.enqueue(async () => {
      const name = this.validateNotebookName(input?.name)
      const icon = this.validateNotebookIcon(input?.icon)
      const parentId = input?.parentId
      if (parentId && !this.data!.notebooks.some((notebook) => notebook.id === parentId)) {
        throw new Error('Parent notebook not found')
      }
      this.assertUniqueNotebookName(name, parentId)

      const notebook: Notebook = { id: randomUUID(), name, icon, ...(parentId ? { parentId } : {}) }
      const nextNotebooks = [...this.data!.notebooks, notebook]
      await mkdir(this.pathForNotebook(notebook.id, nextNotebooks), { recursive: true })
      this.data!.notebooks = nextNotebooks
      this.data!.noteOrder.notebooks[notebook.id] = []
      await this.writeMetadata()
      await this.writeNoteOrder()
      return structuredClone(notebook)
    })
  }

  async updateNotebook(input: UpdateNotebookInput): Promise<LibraryData> {
    await this.ensureLoaded()
    return this.enqueue(async () => {
      if (!input || typeof input.id !== 'string' || input.id.length > 100) {
        throw new Error('Invalid notebook id')
      }
      const index = this.data!.notebooks.findIndex((notebook) => notebook.id === input.id)
      if (index < 0) throw new Error('Notebook not found')

      const previousNotebooks = this.data!.notebooks
      const current = previousNotebooks[index]
      const name = this.validateNotebookName(input.name)
      const icon = this.validateNotebookIcon(input.icon)
      this.assertUniqueNotebookName(name, current.parentId, current.id)
      const updated: Notebook = { ...current, name, icon }
      const nextNotebooks = this.data!.notebooks.map((notebook) =>
        notebook.id === updated.id ? updated : notebook,
      )
      const currentPath = this.pathForNotebook(current.id)
      const nextPath = this.pathForNotebook(updated.id, nextNotebooks)

      if (currentPath !== nextPath) {
        await mkdir(path.dirname(nextPath), { recursive: true })
        await rename(currentPath, nextPath)
        this.replaceNotePathPrefix(currentPath, nextPath)
      }
      this.data!.notebooks = nextNotebooks
      await this.rewriteNotebookPathLinks(previousNotebooks, nextNotebooks)
      this.reconcileCurrentNoteOrder()
      await this.writeMetadata()
      await this.writeNoteOrder()
      return structuredClone(this.data!)
    })
  }

  async moveNotebook(input: MoveNotebookInput): Promise<LibraryData> {
    await this.ensureLoaded()
    return this.enqueue(async () => {
      if (!input || typeof input.id !== 'string' || input.id.length > 100) {
        throw new Error('Invalid notebook id')
      }
      const current = this.data!.notebooks.find((notebook) => notebook.id === input.id)
      if (!current) throw new Error('Notebook not found')
      const parentId = input.parentId
      if (parentId && !this.data!.notebooks.some((notebook) => notebook.id === parentId)) {
        throw new Error('Parent notebook not found')
      }
      if (parentId && this.notebookDescendantIds(current.id).has(parentId)) {
        throw new Error('A notebook cannot be moved inside itself')
      }
      if (current.parentId === parentId) return structuredClone(this.data!)
      this.assertUniqueNotebookName(current.name, parentId, current.id)

      const previousNotebooks = this.data!.notebooks
      const moved: Notebook = { ...current, parentId }
      if (!parentId) delete moved.parentId
      const nextNotebooks = previousNotebooks.map((notebook) =>
        notebook.id === current.id ? moved : notebook,
      )
      const currentPath = this.pathForNotebook(current.id, previousNotebooks)
      const nextPath = this.pathForNotebook(current.id, nextNotebooks)
      await mkdir(path.dirname(nextPath), { recursive: true })
      await rename(currentPath, nextPath)
      this.replaceNotePathPrefix(currentPath, nextPath)
      this.data!.notebooks = nextNotebooks
      await this.rewriteNotebookPathLinks(previousNotebooks, nextNotebooks)
      this.reconcileCurrentNoteOrder()
      await this.writeMetadata()
      await this.writeNoteOrder()
      return structuredClone(this.data!)
    })
  }

  async deleteNotebook(id: string): Promise<LibraryData> {
    await this.ensureLoaded()
    return this.enqueue(async () => {
      if (typeof id !== 'string' || id.length > 100) throw new Error('Invalid notebook id')
      const notebook = this.data!.notebooks.find((item) => item.id === id)
      if (!notebook) throw new Error('Notebook not found')

      const previousNotebooks = this.data!.notebooks
      const previousTargets = new Map(this.data!.notes.map((note) => [note.id, {
        canonical: noteWikiLinkTarget(note, previousNotebooks),
        legacy: legacyNoteWikiLinkTarget(note, previousNotebooks),
      }]))
      const deletedIds = this.notebookDescendantIds(id)
      let nextNotebooks = this.data!.notebooks.filter((item) => !deletedIds.has(item.id))
      let fallback = notebook.parentId
        ? nextNotebooks.find((item) => item.id === notebook.parentId)
        : nextNotebooks.find((item) => !item.parentId) ?? nextNotebooks[0]
      if (!fallback) {
        fallback = { id: randomUUID(), name: 'Notes', icon: 'folder' }
        nextNotebooks = [fallback]
        await mkdir(this.pathForNotebook(fallback.id, nextNotebooks), { recursive: true })
      }

      const notebookPath = this.pathForNotebook(id)
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const archivedPath = path.join(
        this.trashPath,
        'notebooks',
        `${timestamp}-${safeFileName(notebook.name, 'Notebook')}--${notebook.id.slice(0, 8)}`,
      )
      await mkdir(path.dirname(archivedPath), { recursive: true })
      await rename(notebookPath, archivedPath)
      this.replaceNotePathPrefix(notebookPath, archivedPath)

      this.data!.notebooks = nextNotebooks
      const now = new Date().toISOString()
      for (let index = 0; index < this.data!.notes.length; index += 1) {
        const current = this.data!.notes[index]
        if (!deletedIds.has(current.notebookId)) continue
        const note = { ...current, notebookId: fallback.id, updatedAt: now }
        const currentPath = this.notePaths.get(note.id)
        if (!currentPath) throw new Error('Note file not found')
        await atomicWrite(currentPath, serializeNote(note))
        const nextPath = this.pathForNote(note)
        await mkdir(path.dirname(nextPath), { recursive: true })
        await this.moveAttachmentDirectory(note.id, currentPath, nextPath)
        await rename(currentPath, nextPath)
        this.notePaths.set(note.id, nextPath)
        this.data!.notes[index] = note
      }
      const replacements = new Map<string, string>()
      for (const note of this.data!.notes) {
        const previousTarget = previousTargets.get(note.id)
        const nextTarget = noteWikiLinkTarget(note, nextNotebooks)
        if (previousTarget && previousTarget.canonical !== nextTarget) {
          replacements.set(normalizeWikiLinkTarget(previousTarget.canonical), nextTarget)
          replacements.set(normalizeWikiLinkTarget(previousTarget.legacy), nextTarget)
        }
      }
      await this.rewriteLinks(replacements, now)
      this.reconcileCurrentNoteOrder()
      await this.writeMetadata()
      await this.writeNoteOrder()
      return structuredClone(this.data!)
    })
  }

  async create(input: CreateNoteInput = {}): Promise<Note> {
    await this.ensureLoaded()
    return this.enqueue(async () => {
      const now = new Date().toISOString()
      const fallbackNotebook = this.data!.notebooks[0]?.id ?? 'personal'
      const requestedNotebook = this.data!.notebooks.some((item) => item.id === input.notebookId)
        ? input.notebookId
        : fallbackNotebook
      const title = typeof input.title === 'string' ? input.title.trim().slice(0, 240) : ''
      const note: Note = {
        id: randomUUID(),
        notebookId: requestedNotebook ?? fallbackNotebook,
        title: title || 'Untitled note',
        body: '',
        tags: [],
        pinned: false,
        createdAt: now,
        updatedAt: now,
      }

      const notePath = this.pathForNote(note)
      await atomicWrite(notePath, serializeNote(note))
      this.notePaths.set(note.id, notePath)
      this.data!.notes.unshift(note)
      this.data!.noteOrder.all = [note.id, ...this.data!.noteOrder.all.filter((id) => id !== note.id)]
      this.prependNoteToNotebookOrders(note)
      await this.writeNoteOrder()
      return structuredClone(note)
    })
  }

  async save(update: NoteUpdate): Promise<SaveNoteResult> {
    await this.ensureLoaded()
    return this.enqueue(async () => {
      this.validateUpdate(update)
      const index = this.data!.notes.findIndex((note) => note.id === update.id)
      if (index < 0) throw new Error('Note not found')

      const current = this.data!.notes[index]
      const notebookChanged = current.notebookId !== update.notebookId
      const pinnedChanged = current.pinned !== update.pinned
      const nextTitle = update.title.trim().slice(0, 240) || 'Untitled note'
      const titleChanged = current.title !== nextTitle
      const draftNote: Note = {
        ...current,
        title: nextTitle,
        body: update.body,
        notebookId: update.notebookId,
        tags: [...new Set(update.tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 20),
        pinned: update.pinned,
        updatedAt: new Date().toISOString(),
      }
      const replacements = new Map<string, string>()
      if (titleChanged) {
        replacements.set(normalizeWikiLinkTarget(current.title), noteWikiLinkTarget(draftNote, this.data!.notebooks))
      }
      const previousTarget = noteWikiLinkTarget(current, this.data!.notebooks)
      const previousLegacyTarget = legacyNoteWikiLinkTarget(current, this.data!.notebooks)
      const nextTarget = noteWikiLinkTarget(draftNote, this.data!.notebooks)
      if (previousTarget !== nextTarget) {
        replacements.set(normalizeWikiLinkTarget(previousTarget), nextTarget)
        replacements.set(normalizeWikiLinkTarget(previousLegacyTarget), nextTarget)
      }
      const note = { ...draftNote, body: rewriteWikiLinkTargets(draftNote.body, replacements) }
      const currentPath = this.notePaths.get(note.id)
      if (!currentPath) throw new Error('Note file not found')

      await atomicWrite(currentPath, serializeNote(note))
      const nextPath = this.pathForNote(note)
      if (nextPath !== currentPath) {
        await mkdir(path.dirname(nextPath), { recursive: true })
        await this.moveAttachmentDirectory(note.id, currentPath, nextPath)
        await rename(currentPath, nextPath)
        this.notePaths.set(note.id, nextPath)
      }
      this.data!.notes[index] = note

      if (notebookChanged) {
        this.moveNoteBetweenNotebookOrders(current, note)
      }
      if (pinnedChanged) {
        this.data!.noteOrder.pinned = note.pinned
          ? [note.id, ...this.data!.noteOrder.pinned.filter((id) => id !== note.id)]
          : this.data!.noteOrder.pinned.filter((id) => id !== note.id)
      }
      if (notebookChanged || pinnedChanged) await this.writeNoteOrder()

      const linkedNotes = await this.rewriteLinks(replacements, note.updatedAt, note.id)

      return structuredClone({ note, linkedNotes, noteOrder: this.data!.noteOrder })
    })
  }

  async delete(id: string): Promise<void> {
    await this.ensureLoaded()
    await this.enqueue(async () => {
      if (typeof id !== 'string' || id.length > 100) throw new Error('Invalid note id')
      const notePath = this.notePaths.get(id)
      if (!notePath) throw new Error('Note file not found')

      await mkdir(this.trashPath, { recursive: true })
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      await rename(notePath, path.join(this.trashPath, `${timestamp}-${path.basename(notePath)}`))
      const attachmentDirectory = this.attachmentDirectory(id, notePath)
      try {
        await access(attachmentDirectory)
        await rename(
          attachmentDirectory,
          path.join(this.trashPath, `${timestamp}-attachments-${safeFileName(id, 'note')}`),
        )
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      this.notePaths.delete(id)
      this.data!.notes = this.data!.notes.filter((note) => note.id !== id)
      this.removeNoteFromOrders(id)
      await this.writeNoteOrder()
    })
  }

  private async ensureLoaded(): Promise<void> {
    if (this.data) return
    if (!this.loadPromise) this.loadPromise = this.load()
    await this.loadPromise
  }

  private async load(): Promise<void> {
    await mkdir(path.dirname(this.metadataPath), { recursive: true })
    const metadata = await this.readMetadata()
    if (metadata) {
      const notes = await this.readVaultNotes(metadata.notebooks)
      this.data = {
        notebooks: metadata.notebooks,
        notes,
        noteOrder: await this.readNoteOrder(notes, metadata.notebooks),
      }
      return
    }

    const legacyData = await this.readLegacyLibrary()
    const sourceData = legacyData ?? starterData()
    const initialData: LibraryData = {
      notebooks: sourceData.notebooks,
      notes: sourceData.notes,
      noteOrder: reconcileNoteOrder(sourceData.noteOrder, sourceData.notes, sourceData.notebooks),
    }
    await this.writeInitialVault(initialData)
    this.data = initialData
  }

  private async readNoteOrder(notes: Note[], notebooks: Notebook[]): Promise<NoteOrder> {
    try {
      const parsed = JSON.parse(await readFile(this.noteOrderPath, 'utf8')) as Partial<NoteOrder>
      if (
        parsed.version !== NOTE_ORDER_VERSION ||
        !Array.isArray(parsed.all) ||
        !Array.isArray(parsed.pinned) ||
        !parsed.notebooks ||
        typeof parsed.notebooks !== 'object' ||
        !Object.values(parsed.notebooks).every((sequence) =>
          Array.isArray(sequence) && sequence.every((id) => typeof id === 'string'),
        ) ||
        !parsed.all.every((id) => typeof id === 'string') ||
        !parsed.pinned.every((id) => typeof id === 'string')
      ) {
        throw new Error('Invalid note order metadata')
      }
      return reconcileNoteOrder(parsed, notes, notebooks)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('Could not read note ordering; rebuilding it.', error)
      }
      return reconcileNoteOrder(undefined, notes, notebooks)
    }
  }

  private async readMetadata(): Promise<VaultMetadata | null> {
    try {
      const parsed = JSON.parse(await readFile(this.metadataPath, 'utf8')) as Partial<VaultMetadata>
      if (
        parsed.version !== VAULT_VERSION ||
        !Array.isArray(parsed.notebooks) ||
        !parsed.notebooks.every(isNotebook)
      ) {
        throw new Error('Invalid vault metadata')
      }
      return { version: parsed.version, notebooks: parsed.notebooks }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  private async readLegacyLibrary(): Promise<LibraryData | null> {
    try {
      const parsed = JSON.parse(await readFile(this.legacyFilePath, 'utf8')) as LibraryData
      if (
        !Array.isArray(parsed.notes) ||
        !Array.isArray(parsed.notebooks) ||
        !parsed.notebooks.every(isNotebook)
      ) {
        throw new Error('Invalid legacy library data')
      }
      return parsed
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      console.warn('Could not migrate the legacy library; creating a fresh vault.', error)
      return null
    }
  }

  private async readVaultNotes(notebooks: Notebook[]): Promise<Note[]> {
    const notes: Note[] = []
    const fallbackNotebookId = notebooks[0]?.id ?? 'personal'
    const notebookIds = new Set(notebooks.map((notebook) => notebook.id))
    for (const notePath of await readMarkdownFiles(this.vaultPath)) {
      try {
        const filename = path.basename(notePath, MARKDOWN_EXTENSION).replace(/--[a-zA-Z0-9-]{1,20}$/, '')
        const note = parseNoteFile(await readFile(notePath, 'utf8'), filename, fallbackNotebookId)
        if (!notebookIds.has(note.notebookId)) note.notebookId = fallbackNotebookId
        if (this.notePaths.has(note.id)) {
          console.warn(`Ignoring duplicate note id ${note.id} in ${notePath}`)
          continue
        }
        this.notePaths.set(note.id, notePath)
        notes.push(note)
      } catch (error) {
        console.warn(`Could not read note ${notePath}`, error)
      }
    }
    return notes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  private async writeInitialVault(data: LibraryData): Promise<void> {
    for (const notebook of data.notebooks) {
      await mkdir(this.pathForNotebook(notebook.id, data.notebooks), { recursive: true })
    }
    for (const note of data.notes) {
      const notePath = this.pathForNote(note, data.notebooks)
      await atomicWrite(notePath, serializeNote(note))
      this.notePaths.set(note.id, notePath)
    }
    const metadata: VaultMetadata = { version: VAULT_VERSION, notebooks: data.notebooks }
    await atomicWrite(this.metadataPath, JSON.stringify(metadata, null, 2))
    await atomicWrite(this.noteOrderPath, JSON.stringify(data.noteOrder, null, 2))
  }

  private pathForNote(note: Note, notebooks = this.data?.notebooks ?? []): string {
    const title = safeFileName(note.title, 'Untitled note')
    const stableId = safeFileName(note.id.slice(0, 12), 'note')
    return path.join(
      this.pathForNotebook(note.notebookId, notebooks),
      `${title}--${stableId}${MARKDOWN_EXTENSION}`,
    )
  }

  private attachmentDirectory(noteId: string, notePath: string): string {
    return path.join(path.dirname(notePath), '.attachments', safeFileName(noteId, 'note'))
  }

  private async moveAttachmentDirectory(
    noteId: string,
    previousNotePath: string,
    nextNotePath: string,
  ): Promise<void> {
    const previousDirectory = this.attachmentDirectory(noteId, previousNotePath)
    const nextDirectory = this.attachmentDirectory(noteId, nextNotePath)
    if (previousDirectory === nextDirectory) return
    try {
      await access(previousDirectory)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    await mkdir(path.dirname(nextDirectory), { recursive: true })
    await rename(previousDirectory, nextDirectory)
  }

  private pathForNotebook(id: string, notebooks = this.data?.notebooks ?? []): string {
    const byId = new Map(notebooks.map((notebook) => [notebook.id, notebook]))
    const segments: string[] = []
    const visited = new Set<string>()
    let notebook = byId.get(id)
    while (notebook && !visited.has(notebook.id)) {
      visited.add(notebook.id)
      segments.unshift(safeFileName(notebook.name, 'Notes'))
      notebook = notebook.parentId ? byId.get(notebook.parentId) : undefined
    }
    return path.join(this.vaultPath, ...(segments.length > 0 ? segments : ['Notes']))
  }

  private notebookDescendantIds(id: string): Set<string> {
    const ids = new Set<string>([id])
    let changed = true
    while (changed) {
      changed = false
      for (const notebook of this.data!.notebooks) {
        if (notebook.parentId && ids.has(notebook.parentId) && !ids.has(notebook.id)) {
          ids.add(notebook.id)
          changed = true
        }
      }
    }
    return ids
  }

  private noteIdsForScope(scope: string): string[] {
    if (scope === 'all') return this.data!.notes.map((note) => note.id)
    if (scope === 'pinned') {
      return this.data!.notes.filter((note) => note.pinned).map((note) => note.id)
    }
    if (!this.data!.notebooks.some((notebook) => notebook.id === scope)) {
      throw new Error('Notebook not found')
    }
    const descendants = this.notebookDescendantIds(scope)
    return this.data!.notes
      .filter((note) => descendants.has(note.notebookId))
      .map((note) => note.id)
  }

  private noteOrderForScope(scope: string): string[] {
    if (scope === 'all') return this.data!.noteOrder.all
    if (scope === 'pinned') return this.data!.noteOrder.pinned
    return this.data!.noteOrder.notebooks[scope] ?? []
  }

  private setNoteOrderForScope(scope: string, sequence: string[]): void {
    if (scope === 'all') this.data!.noteOrder.all = sequence
    else if (scope === 'pinned') this.data!.noteOrder.pinned = sequence
    else this.data!.noteOrder.notebooks[scope] = sequence
  }

  private prependNoteToNotebookOrders(note: Note): void {
    for (const notebook of this.data!.notebooks) {
      if (!this.notebookDescendantIds(notebook.id).has(note.notebookId)) continue
      const sequence = this.data!.noteOrder.notebooks[notebook.id] ?? []
      this.data!.noteOrder.notebooks[notebook.id] = [
        note.id,
        ...sequence.filter((id) => id !== note.id),
      ]
    }
  }

  private moveNoteBetweenNotebookOrders(previous: Note, next: Note): void {
    for (const notebook of this.data!.notebooks) {
      const descendants = this.notebookDescendantIds(notebook.id)
      const wasVisible = descendants.has(previous.notebookId)
      const isVisible = descendants.has(next.notebookId)
      const sequence = this.data!.noteOrder.notebooks[notebook.id] ?? []
      if (wasVisible && !isVisible) {
        this.data!.noteOrder.notebooks[notebook.id] = sequence.filter((id) => id !== next.id)
      } else if (!wasVisible && isVisible) {
        this.data!.noteOrder.notebooks[notebook.id] = [
          next.id,
          ...sequence.filter((id) => id !== next.id),
        ]
      }
    }
  }

  private removeNoteFromOrders(id: string): void {
    this.data!.noteOrder.all = this.data!.noteOrder.all.filter((item) => item !== id)
    this.data!.noteOrder.pinned = this.data!.noteOrder.pinned.filter((item) => item !== id)
    for (const notebookId of Object.keys(this.data!.noteOrder.notebooks)) {
      this.data!.noteOrder.notebooks[notebookId] = this.data!.noteOrder.notebooks[notebookId]
        .filter((item) => item !== id)
    }
  }

  private reconcileCurrentNoteOrder(): void {
    this.data!.noteOrder = reconcileNoteOrder(
      this.data!.noteOrder,
      this.data!.notes,
      this.data!.notebooks,
    )
  }

  private replaceNotePathPrefix(previousPrefix: string, nextPrefix: string): void {
    const prefix = `${previousPrefix}${path.sep}`
    for (const [id, notePath] of this.notePaths) {
      if (!notePath.startsWith(prefix)) continue
      this.notePaths.set(id, path.join(nextPrefix, path.relative(previousPrefix, notePath)))
    }
  }

  private async writeMetadata(): Promise<void> {
    const metadata: VaultMetadata = { version: VAULT_VERSION, notebooks: this.data!.notebooks }
    await atomicWrite(this.metadataPath, JSON.stringify(metadata, null, 2))
  }

  private async writeNoteOrder(): Promise<void> {
    await atomicWrite(this.noteOrderPath, JSON.stringify(this.data!.noteOrder, null, 2))
  }

  private setVaultPath(vaultPath: string): void {
    this.vaultPath = path.resolve(vaultPath)
    this.metadataPath = path.join(this.vaultPath, '.folio', 'library.json')
    this.noteOrderPath = path.join(this.vaultPath, '.folio', 'note-order.json')
    this.trashPath = path.join(this.vaultPath, '.folio', 'trash')
  }

  private async validateVaultDirectory(vaultPath: string): Promise<void> {
    const parsed = JSON.parse(
      await readFile(path.join(vaultPath, '.folio', 'library.json'), 'utf8'),
    ) as Partial<VaultMetadata>
    if (
      parsed.version !== VAULT_VERSION ||
      !Array.isArray(parsed.notebooks) ||
      !parsed.notebooks.every(isNotebook)
    ) {
      throw new Error('The selected folder is not a valid Folio backup')
    }
    for (const notePath of await readMarkdownFiles(vaultPath)) {
      parseNoteFile(await readFile(notePath, 'utf8'), path.basename(notePath, MARKDOWN_EXTENSION))
    }
  }

  private validateNotebookName(value: unknown): string {
    if (typeof value !== 'string') throw new Error('Invalid notebook name')
    const name = value.trim().replace(/\s+/g, ' ').slice(0, 80)
    if (!name) throw new Error('Notebook name is required')
    return name
  }

  private validateNotebookIcon(value: unknown): string {
    if (typeof value !== 'string' || !NOTEBOOK_ICONS.has(value)) {
      throw new Error('Invalid notebook icon')
    }
    return value
  }

  private assertUniqueNotebookName(name: string, parentId?: string, exceptId?: string): void {
    const directoryName = safeFileName(name, 'Notes').toLocaleLowerCase()
    if (
      this.data!.notebooks.some(
        (notebook) =>
          notebook.id !== exceptId &&
          notebook.parentId === parentId &&
          safeFileName(notebook.name, 'Notes').toLocaleLowerCase() === directoryName,
      )
    ) {
      throw new Error('A notebook with this name already exists here')
    }
  }

  private async rewriteNotebookPathLinks(
    previousNotebooks: Notebook[],
    nextNotebooks: Notebook[],
  ): Promise<void> {
    const replacements = new Map<string, string>()
    for (const note of this.data!.notes) {
      const previousTarget = noteWikiLinkTarget(note, previousNotebooks)
      const previousLegacyTarget = legacyNoteWikiLinkTarget(note, previousNotebooks)
      const nextTarget = noteWikiLinkTarget(note, nextNotebooks)
      if (previousTarget !== nextTarget) {
        replacements.set(normalizeWikiLinkTarget(previousTarget), nextTarget)
        replacements.set(normalizeWikiLinkTarget(previousLegacyTarget), nextTarget)
      }
    }
    await this.rewriteLinks(replacements, new Date().toISOString())
  }

  private async rewriteLinks(
    replacements: ReadonlyMap<string, string>,
    updatedAt: string,
    excludedNoteId?: string,
  ): Promise<Note[]> {
    const linkedNotes: Note[] = []
    if (replacements.size === 0) return linkedNotes
    for (let index = 0; index < this.data!.notes.length; index += 1) {
      const linkedNote = this.data!.notes[index]
      if (linkedNote.id === excludedNoteId) continue
      const body = rewriteWikiLinkTargets(linkedNote.body, replacements)
      if (body === linkedNote.body) continue
      const updatedLinkedNote = { ...linkedNote, body, updatedAt }
      const linkedPath = this.notePaths.get(linkedNote.id)
      if (!linkedPath) throw new Error('Linked note file not found')
      await atomicWrite(linkedPath, serializeNote(updatedLinkedNote))
      this.data!.notes[index] = updatedLinkedNote
      linkedNotes.push(updatedLinkedNote)
    }
    return linkedNotes
  }

  private validateUpdate(update: NoteUpdate): void {
    if (!update || typeof update !== 'object') throw new Error('Invalid note update')
    if (typeof update.id !== 'string' || update.id.length > 100) throw new Error('Invalid note id')
    if (typeof update.title !== 'string') throw new Error('Invalid title')
    if (typeof update.body !== 'string' || update.body.length > 10_000_000) throw new Error('Invalid body')
    if (typeof update.notebookId !== 'string') throw new Error('Invalid notebook')
    if (!isStringArray(update.tags)) throw new Error('Invalid tags')
    if (typeof update.pinned !== 'boolean') throw new Error('Invalid pin state')
    if (!this.data!.notebooks.some((notebook) => notebook.id === update.notebookId)) {
      throw new Error('Notebook not found')
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation)
    this.operationQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}
