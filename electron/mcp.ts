import { access } from 'node:fs/promises'
import path from 'node:path'
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server'
import * as z from 'zod/v4'
import { QmdSearchService } from './search'
import { LibraryStore } from './store'
import type {
  LibraryData,
  Note,
  Notebook,
  NoteSearchResult,
  SearchMode,
} from './types'
import {
  legacyNoteWikiLinkTarget,
  normalizeWikiLinkTarget,
  noteWikiLinkTarget,
} from './wiki-links'

const NOTEBOOK_ICONS = [
  'archive',
  'book-open',
  'bookmark',
  'briefcase',
  'code',
  'folder',
  'home',
  'lightbulb',
  'star',
] as const

export interface FolioMcpOptions {
  vaultPath: string
  userDataPath: string
  qmdWorkerPath?: string
  searchIndexPath?: string
  nodeRuntimePath?: string
}

interface NoteSummary {
  id: string
  title: string
  path: string
  wikiLink: string
  notebookId: string
  notebookPath: string
  tags: string[]
  pinned: boolean
  createdAt: string
  updatedAt: string
}

const extractWikiLinks = (body: string): string[] => [...body.matchAll(/\[\[([^\]|\n]+)(?:\|[^\]\n]+)?\]\]/g)]
  .map((match) => match[1].trim())

const notebookPath = (notebooks: Notebook[], notebookId: string): string => {
  const byId = new Map(notebooks.map((notebook) => [notebook.id, notebook]))
  const names: string[] = []
  const visited = new Set<string>()
  let notebook = byId.get(notebookId)
  while (notebook && !visited.has(notebook.id)) {
    visited.add(notebook.id)
    names.unshift(notebook.name)
    notebook = notebook.parentId ? byId.get(notebook.parentId) : undefined
  }
  return names.join('/')
}

const descendantNotebookIds = (notebooks: Notebook[], id: string): Set<string> => {
  const ids = new Set([id])
  let changed = true
  while (changed) {
    changed = false
    for (const notebook of notebooks) {
      if (!notebook.parentId || !ids.has(notebook.parentId) || ids.has(notebook.id)) continue
      ids.add(notebook.id)
      changed = true
    }
  }
  return ids
}

const keywordResults = (notes: Note[], query: string, limit: number): NoteSearchResult[] => {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return []
  const terms = normalizedQuery.split(/\s+/).filter(Boolean)
  return notes
    .map<NoteSearchResult | null>((note) => {
      const title = note.title.toLocaleLowerCase()
      const body = note.body.toLocaleLowerCase()
      const tags = note.tags.join(' ').toLocaleLowerCase()
      if (!terms.every((term) => title.includes(term) || body.includes(term) || tags.includes(term))) {
        return null
      }
      const firstIndex = body.indexOf(terms[0])
      const start = Math.max(0, firstIndex < 0 ? 0 : firstIndex - 70)
      const snippet = note.body.slice(start, start + 220).replace(/\s+/g, ' ').trim()
      const score = terms.reduce((total, term) => total + (
        title.includes(term) ? 4 : tags.includes(term) ? 2 : 1
      ), 0)
      return { noteId: note.id, score, snippet, source: 'keyword' }
    })
    .filter((result): result is NoteSearchResult => result !== null)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
}

const appendWithSeparator = (body: string, content: string, separator: string): string => {
  if (!body) return content
  let overlap = Math.min(body.length, separator.length)
  while (overlap > 0 && !body.endsWith(separator.slice(0, overlap))) overlap -= 1
  return `${body}${separator.slice(overlap)}${content}`
}

export class FolioMcpService {
  readonly vaultPath: string
  private readonly library: LibraryStore
  private readonly search?: QmdSearchService
  private operationQueue = Promise.resolve()

  constructor(options: FolioMcpOptions) {
    this.vaultPath = path.resolve(options.vaultPath)
    this.library = new LibraryStore(options.userDataPath, this.vaultPath)
    if (options.qmdWorkerPath && options.searchIndexPath) {
      this.search = new QmdSearchService(
        this.vaultPath,
        options.searchIndexPath,
        options.qmdWorkerPath,
        (status) => {
          if (status.state === 'error' && status.message) console.error(`[folio-search] ${status.message}`)
        },
        options.nodeRuntimePath,
      )
    }
  }

  async validate(): Promise<void> {
    await access(path.join(this.vaultPath, '.folio', 'library.json'))
  }

  close(): Promise<void> {
    return this.search?.close() ?? Promise.resolve()
  }

  async vaultStatus() {
    return this.withFreshLibrary(async (data) => ({
      vaultPath: this.vaultPath,
      noteCount: data.notes.length,
      notebookCount: data.notebooks.length,
      searchModes: this.search
        ? ['keyword', 'semantic', 'hybrid'] as SearchMode[]
        : ['keyword'] as SearchMode[],
      markdownIsSourceOfTruth: true,
    }))
  }

  async listNotebooks() {
    return this.withFreshLibrary(async (data) => ({
      notebooks: data.notebooks.map((notebook) => ({
        ...notebook,
        path: notebookPath(data.notebooks, notebook.id),
        noteCount: data.notes.filter((note) => note.notebookId === notebook.id).length,
        descendantNoteCount: data.notes.filter((note) =>
          descendantNotebookIds(data.notebooks, notebook.id).has(note.notebookId)).length,
      })),
    }))
  }

  async listNotes(input: {
    notebookId?: string
    includeDescendants: boolean
    tag?: string
    pinned?: boolean
    limit: number
  }) {
    return this.withFreshLibrary(async (data) => {
      let notes = data.notes
      if (input.notebookId) {
        const notebook = data.notebooks.find((item) => item.id === input.notebookId)
        if (!notebook) throw new Error('Notebook not found')
        const ids = input.includeDescendants
          ? descendantNotebookIds(data.notebooks, notebook.id)
          : new Set([notebook.id])
        notes = notes.filter((note) => ids.has(note.notebookId))
      }
      if (input.tag) {
        const tag = input.tag.toLocaleLowerCase()
        notes = notes.filter((note) => note.tags.some((item) => item.toLocaleLowerCase() === tag))
      }
      if (input.pinned !== undefined) notes = notes.filter((note) => note.pinned === input.pinned)
      notes = [...notes]
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, input.limit)
      return {
        notes: await Promise.all(notes.map((note) => this.noteSummary(note, data.notebooks))),
        returned: notes.length,
      }
    })
  }

  async getNote(reference: string, offset: number, maxCharacters: number) {
    return this.withFreshLibrary(async (data) => {
      const note = await this.findNote(data, reference)
      const summary = await this.noteSummary(note, data.notebooks)
      const body = note.body.slice(offset, offset + maxCharacters)
      const nextOffset = offset + body.length
      const target = normalizeWikiLinkTarget(noteWikiLinkTarget(note, data.notebooks))
      const legacyTargets = new Set([
        normalizeWikiLinkTarget(note.title),
        normalizeWikiLinkTarget(legacyNoteWikiLinkTarget(note, data.notebooks)),
      ])
      const backlinks = await Promise.all(data.notes
        .filter((candidate) => candidate.id !== note.id && extractWikiLinks(candidate.body).some((link) => {
          const normalized = normalizeWikiLinkTarget(link)
          return normalized === target || legacyTargets.has(normalized)
        }))
        .map((candidate) => this.noteSummary(candidate, data.notebooks)))
      return {
        note: summary,
        body,
        offset,
        nextOffset: nextOffset < note.body.length ? nextOffset : null,
        totalCharacters: note.body.length,
        outgoingLinks: extractWikiLinks(note.body),
        backlinks,
      }
    })
  }

  async searchNotes(query: string, mode: SearchMode, limit: number) {
    this.search?.markDirty()
    const results = this.search
      ? await this.search.search({ query, mode, limit })
      : mode === 'keyword'
        ? await this.withFreshLibrary(async (data) => keywordResults(data.notes, query, limit))
        : (() => { throw new Error('Semantic search is not configured for this MCP server') })()
    return this.withFreshLibrary(async (data) => {
      const notesById = new Map(data.notes.map((note) => [note.id, note]))
      const matches = await Promise.all(results.map(async (result) => {
        const note = notesById.get(result.noteId)
        if (!note) return null
        return {
          ...result,
          note: await this.noteSummary(note, data.notebooks),
        }
      }))
      return { query, mode, matches: matches.filter((match) => match !== null) }
    })
  }

  async createNote(input: {
    title: string
    body: string
    notebookId?: string
    tags: string[]
    pinned: boolean
  }) {
    return this.withFreshLibrary(async (data) => {
      const notebookId = input.notebookId ?? data.notebooks[0]?.id
      if (!notebookId) throw new Error('The vault has no notebook')
      if (!data.notebooks.some((notebook) => notebook.id === notebookId)) {
        throw new Error('Notebook not found')
      }
      const created = await this.library.create({ title: input.title, notebookId })
      const saved = await this.library.save({
        ...created,
        body: input.body,
        tags: input.tags,
        pinned: input.pinned,
      })
      this.search?.markDirty()
      return {
        note: await this.noteSummary(saved.note, data.notebooks),
        body: saved.note.body,
      }
    })
  }

  async updateNote(input: {
    reference: string
    expectedUpdatedAt: string
    title?: string
    body?: string
    notebookId?: string
    tags?: string[]
    pinned?: boolean
  }) {
    return this.withFreshLibrary(async (data) => {
      if (
        input.title === undefined &&
        input.body === undefined &&
        input.notebookId === undefined &&
        input.tags === undefined &&
        input.pinned === undefined
      ) {
        throw new Error('Provide at least one note field to update')
      }
      const note = await this.findNote(data, input.reference)
      this.assertCurrent(note, input.expectedUpdatedAt)
      const saved = await this.library.save({
        id: note.id,
        title: input.title ?? note.title,
        body: input.body ?? note.body,
        notebookId: input.notebookId ?? note.notebookId,
        tags: input.tags ?? note.tags,
        pinned: input.pinned ?? note.pinned,
      })
      this.search?.markDirty()
      const nextData = await this.library.list()
      return {
        note: await this.noteSummary(saved.note, nextData.notebooks),
        body: saved.note.body,
        rewrittenLinkedNoteIds: saved.linkedNotes.map((linkedNote) => linkedNote.id),
      }
    })
  }

  async appendToNote(reference: string, expectedUpdatedAt: string, content: string, separator: string) {
    return this.withFreshLibrary(async (data) => {
      const note = await this.findNote(data, reference)
      this.assertCurrent(note, expectedUpdatedAt)
      const saved = await this.library.save({
        ...note,
        body: appendWithSeparator(note.body, content, separator),
      })
      this.search?.markDirty()
      return {
        note: await this.noteSummary(saved.note, data.notebooks),
        appendedCharacters: content.length,
      }
    })
  }

  async replaceNoteText(input: {
    reference: string
    expectedUpdatedAt: string
    oldText: string
    newText: string
    replaceAll: boolean
  }) {
    return this.withFreshLibrary(async (data) => {
      const note = await this.findNote(data, input.reference)
      this.assertCurrent(note, input.expectedUpdatedAt)
      const occurrences = note.body.split(input.oldText).length - 1
      if (occurrences === 0) throw new Error('The exact text was not found in the note')
      if (!input.replaceAll && occurrences !== 1) {
        throw new Error(`The exact text occurs ${occurrences} times; provide more context or set replace_all`)
      }
      const body = input.replaceAll
        ? note.body.split(input.oldText).join(input.newText)
        : note.body.replace(input.oldText, input.newText)
      const saved = await this.library.save({ ...note, body })
      this.search?.markDirty()
      return {
        note: await this.noteSummary(saved.note, data.notebooks),
        replacements: input.replaceAll ? occurrences : 1,
      }
    })
  }

  async deleteNote(reference: string, expectedUpdatedAt: string, confirmTitle: string) {
    return this.withFreshLibrary(async (data) => {
      const note = await this.findNote(data, reference)
      this.assertCurrent(note, expectedUpdatedAt)
      if (confirmTitle !== note.title) throw new Error('confirm_title must exactly match the note title')
      await this.library.delete(note.id)
      this.search?.markDirty()
      return { deleted: true, id: note.id, title: note.title, recoverableFromTrash: true }
    })
  }

  async createNotebook(name: string, icon: typeof NOTEBOOK_ICONS[number], parentId?: string) {
    return this.withFreshLibrary(async () => {
      const notebook = await this.library.createNotebook({ name, icon, parentId })
      return { notebook, path: (await this.library.itemPath('notebook', notebook.id)).relativePath }
    })
  }

  async updateNotebook(input: {
    id: string
    name?: string
    icon?: typeof NOTEBOOK_ICONS[number]
    parentId?: string | null
  }) {
    return this.withFreshLibrary(async (data) => {
      if (input.name === undefined && input.icon === undefined && input.parentId === undefined) {
        throw new Error('Provide at least one notebook field to update')
      }
      const current = data.notebooks.find((notebook) => notebook.id === input.id)
      if (!current) throw new Error('Notebook not found')
      if (input.name !== undefined || input.icon !== undefined) {
        await this.library.updateNotebook({
          id: current.id,
          name: input.name ?? current.name,
          icon: input.icon ?? current.icon,
        })
      }
      if (input.parentId !== undefined) {
        await this.library.moveNotebook({
          id: current.id,
          ...(input.parentId ? { parentId: input.parentId } : {}),
        })
      }
      this.search?.markDirty()
      const nextData = await this.library.list()
      const notebook = nextData.notebooks.find((item) => item.id === current.id)
      if (!notebook) throw new Error('Notebook not found after update')
      return { notebook, path: (await this.library.itemPath('notebook', notebook.id)).relativePath }
    })
  }

  async deleteNotebook(id: string, confirmName: string) {
    return this.withFreshLibrary(async (data) => {
      const notebook = data.notebooks.find((item) => item.id === id)
      if (!notebook) throw new Error('Notebook not found')
      if (confirmName !== notebook.name) {
        throw new Error('confirm_name must exactly match the notebook name')
      }
      const affectedNoteIds = data.notes
        .filter((note) => descendantNotebookIds(data.notebooks, id).has(note.notebookId))
        .map((note) => note.id)
      await this.library.deleteNotebook(id)
      this.search?.markDirty()
      return {
        deleted: true,
        id,
        name: notebook.name,
        affectedNoteIds,
        notesWereMovedNotDeleted: true,
        recoverableFromTrash: true,
      }
    })
  }

  private withFreshLibrary<T>(operation: (data: LibraryData) => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(async () => {
      const data = await this.library.reload()
      return operation(data)
    })
    this.operationQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private async noteSummary(note: Note, notebooks: Notebook[]): Promise<NoteSummary> {
    const itemPath = await this.library.itemPath('note', note.id)
    return {
      id: note.id,
      title: note.title,
      path: itemPath.relativePath,
      wikiLink: `[[${itemPath.relativePath}]]`,
      notebookId: note.notebookId,
      notebookPath: notebookPath(notebooks, note.notebookId),
      tags: note.tags,
      pinned: note.pinned,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    }
  }

  private async findNote(data: LibraryData, rawReference: string): Promise<Note> {
    const reference = rawReference.trim().replace(/^\[\[|\]\]$/g, '').split('|', 1)[0].trim()
    const byId = data.notes.find((note) => note.id === reference)
    if (byId) return byId
    const normalizedReference = normalizeWikiLinkTarget(reference)
    const pathMatches: Note[] = []
    for (const note of data.notes) {
      const itemPath = await this.library.itemPath('note', note.id)
      if (normalizeWikiLinkTarget(itemPath.relativePath) === normalizedReference) pathMatches.push(note)
    }
    if (pathMatches.length === 1) return pathMatches[0]
    const titleMatches = data.notes.filter((note) =>
      note.title.toLocaleLowerCase() === reference.toLocaleLowerCase())
    if (titleMatches.length === 1) return titleMatches[0]
    if (pathMatches.length > 1 || titleMatches.length > 1) {
      throw new Error('Note reference is ambiguous; use the note id or unique path')
    }
    throw new Error('Note not found')
  }

  private assertCurrent(note: Note, expectedUpdatedAt: string): void {
    if (note.updatedAt !== expectedUpdatedAt) {
      throw new Error(
        `Note changed since it was read (expected ${expectedUpdatedAt}, current ${note.updatedAt}). Read it again before editing.`,
      )
    }
  }
}

const toolResult = (value: object, summary?: string) => ({
  content: [{ type: 'text' as const, text: summary ?? JSON.stringify(value, null, 2) }],
  structuredContent: value as Record<string, unknown>,
})

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
}

const writeAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
}

export const createFolioMcpServer = (service: FolioMcpService): McpServer => {
  const server = new McpServer(
    { name: 'folio', version: '0.1.0' },
    {
      instructions: 'Folio is the user’s local Markdown vault. Read with list_notes, search_notes, then get_note before changing content. Mutations require the note’s exact expected_updated_at to prevent stale overwrites; prefer replace_note_text or append_to_note over replacing an entire body. Never delete unless the user explicitly asks, and pass the exact title/name confirmation. Markdown files are the source of truth and changes appear in Folio automatically.',
    },
  )

  server.registerResource(
    'vault-overview',
    'folio://vault',
    {
      title: 'Folio vault overview',
      description: 'Counts, local vault path, and available search modes.',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await service.vaultStatus(), null, 2) }],
    }),
  )

  server.registerResource(
    'note',
    new ResourceTemplate('folio://notes/{noteId}', {
      list: async () => {
        const result = await service.listNotes({ includeDescendants: true, limit: 1_000 })
        return {
          resources: result.notes.map((note) => ({
            name: note.title,
            title: note.title,
            uri: `folio://notes/${encodeURIComponent(note.id)}`,
            description: note.path,
            mimeType: 'text/markdown',
          })),
        }
      },
      complete: {
        noteId: async (value) => {
          const result = await service.listNotes({ includeDescendants: true, limit: 100 })
          return result.notes
            .filter((note) => note.id.startsWith(value) || note.title.toLocaleLowerCase().includes(value.toLocaleLowerCase()))
            .map((note) => note.id)
        },
      },
    }),
    {
      title: 'Folio note',
      description: 'A Markdown note addressed by its stable Folio id.',
      mimeType: 'text/markdown',
    },
    async (uri, variables) => {
      const rawId = Array.isArray(variables.noteId) ? variables.noteId[0] : variables.noteId
      const result = await service.getNote(rawId, 0, 1_000_000)
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'text/markdown',
          text: `<!-- Folio metadata\n${JSON.stringify(result.note, null, 2)}\n-->\n\n${result.body}`,
        }],
      }
    },
  )

  server.registerTool('vault_status', {
    title: 'Get vault status',
    description: 'Return the active Folio vault path, note/notebook counts, and available search modes.',
    inputSchema: z.object({}),
    annotations: readOnlyAnnotations,
  }, async () => toolResult(await service.vaultStatus()))

  server.registerTool('list_notebooks', {
    title: 'List notebooks',
    description: 'List the complete notebook tree with stable ids, paths, icons, and note counts.',
    inputSchema: z.object({}),
    annotations: readOnlyAnnotations,
  }, async () => toolResult(await service.listNotebooks()))

  server.registerTool('list_notes', {
    title: 'List notes',
    description: 'List note metadata without loading full bodies. Use a returned id or unique path with get_note.',
    inputSchema: z.object({
      notebook_id: z.string().max(100).optional().describe('Filter to a notebook id.'),
      include_descendants: z.boolean().default(true),
      tag: z.string().max(100).optional(),
      pinned: z.boolean().optional(),
      limit: z.number().int().min(1).max(1_000).default(100),
    }),
    annotations: readOnlyAnnotations,
  }, async (input) => toolResult(await service.listNotes({
    notebookId: input.notebook_id,
    includeDescendants: input.include_descendants,
    tag: input.tag,
    pinned: input.pinned,
    limit: input.limit,
  })))

  server.registerTool('get_note', {
    title: 'Read a note',
    description: 'Read note metadata, Markdown body, links, and backlinks by id, unique vault path, wiki link, or unambiguous title. Large notes can be paged.',
    inputSchema: z.object({
      note: z.string().min(1).max(1_000),
      offset: z.number().int().min(0).default(0),
      max_characters: z.number().int().min(1).max(1_000_000).default(200_000),
    }),
    annotations: readOnlyAnnotations,
  }, async (input) => toolResult(await service.getNote(input.note, input.offset, input.max_characters)))

  server.registerTool('search_notes', {
    title: 'Search notes',
    description: 'Search the vault using keyword, local semantic, or hybrid retrieval. Results include scores, snippets, ids, and paths.',
    inputSchema: z.object({
      query: z.string().min(1).max(1_000),
      mode: z.enum(['keyword', 'semantic', 'hybrid']).default('hybrid'),
      limit: z.number().int().min(1).max(100).default(20),
    }),
    annotations: readOnlyAnnotations,
  }, async (input) => toolResult(await service.searchNotes(input.query, input.mode, input.limit)))

  server.registerTool('create_note', {
    title: 'Create a note',
    description: 'Create a real Markdown note in a Folio notebook. Use list_notebooks first when choosing a notebook.',
    inputSchema: z.object({
      title: z.string().min(1).max(240),
      body: z.string().max(10_000_000).default(''),
      notebook_id: z.string().max(100).optional(),
      tags: z.array(z.string().max(100)).max(20).default([]),
      pinned: z.boolean().default(false),
    }),
    annotations: writeAnnotations,
  }, async (input) => toolResult(await service.createNote({
    title: input.title,
    body: input.body,
    notebookId: input.notebook_id,
    tags: input.tags,
    pinned: input.pinned,
  })))

  server.registerTool('update_note', {
    title: 'Update note properties',
    description: 'Update title, full Markdown body, notebook, tags, or pin state. Renames and moves rewrite affected Folio wiki links.',
    inputSchema: z.object({
      note: z.string().min(1).max(1_000),
      expected_updated_at: z.string().datetime(),
      title: z.string().min(1).max(240).optional(),
      body: z.string().max(10_000_000).optional(),
      notebook_id: z.string().max(100).optional(),
      tags: z.array(z.string().max(100)).max(20).optional(),
      pinned: z.boolean().optional(),
    }),
    annotations: writeAnnotations,
  }, async (input) => toolResult(await service.updateNote({
    reference: input.note,
    expectedUpdatedAt: input.expected_updated_at,
    title: input.title,
    body: input.body,
    notebookId: input.notebook_id,
    tags: input.tags,
    pinned: input.pinned,
  })))

  server.registerTool('append_to_note', {
    title: 'Append to a note',
    description: 'Append Markdown while preserving all existing content. Safer than replacing the full body.',
    inputSchema: z.object({
      note: z.string().min(1).max(1_000),
      expected_updated_at: z.string().datetime(),
      content: z.string().min(1).max(10_000_000),
      separator: z.string().max(20).default('\n\n'),
    }),
    annotations: writeAnnotations,
  }, async (input) => toolResult(await service.appendToNote(
    input.note,
    input.expected_updated_at,
    input.content,
    input.separator,
  )))

  server.registerTool('replace_note_text', {
    title: 'Replace exact note text',
    description: 'Replace an exact Markdown fragment. By default it refuses ambiguous multiple matches.',
    inputSchema: z.object({
      note: z.string().min(1).max(1_000),
      expected_updated_at: z.string().datetime(),
      old_text: z.string().min(1).max(10_000_000),
      new_text: z.string().max(10_000_000),
      replace_all: z.boolean().default(false),
    }),
    annotations: writeAnnotations,
  }, async (input) => toolResult(await service.replaceNoteText({
    reference: input.note,
    expectedUpdatedAt: input.expected_updated_at,
    oldText: input.old_text,
    newText: input.new_text,
    replaceAll: input.replace_all,
  })))

  server.registerTool('delete_note', {
    title: 'Delete a note',
    description: 'Move a note and its attachments to Folio trash. Requires the current timestamp and exact title as confirmation.',
    inputSchema: z.object({
      note: z.string().min(1).max(1_000),
      expected_updated_at: z.string().datetime(),
      confirm_title: z.string().min(1).max(240),
    }),
    annotations: { ...writeAnnotations, destructiveHint: true },
  }, async (input) => toolResult(await service.deleteNote(
    input.note,
    input.expected_updated_at,
    input.confirm_title,
  )))

  server.registerTool('create_notebook', {
    title: 'Create a notebook',
    description: 'Create a directory-backed notebook, optionally below another notebook.',
    inputSchema: z.object({
      name: z.string().min(1).max(80),
      icon: z.enum(NOTEBOOK_ICONS).default('folder'),
      parent_id: z.string().max(100).optional(),
    }),
    annotations: writeAnnotations,
  }, async (input) => toolResult(await service.createNotebook(input.name, input.icon, input.parent_id)))

  server.registerTool('update_notebook', {
    title: 'Update a notebook',
    description: 'Rename, change the icon, or move a notebook. Path changes automatically rewrite affected wiki links.',
    inputSchema: z.object({
      id: z.string().min(1).max(100),
      name: z.string().min(1).max(80).optional(),
      icon: z.enum(NOTEBOOK_ICONS).optional(),
      parent_id: z.string().max(100).nullable().optional().describe('A notebook id, or null to move to the root.'),
    }),
    annotations: writeAnnotations,
  }, async (input) => toolResult(await service.updateNotebook({
    id: input.id,
    name: input.name,
    icon: input.icon,
    parentId: input.parent_id,
  })))

  server.registerTool('delete_notebook', {
    title: 'Delete a notebook',
    description: 'Delete a notebook directory recoverably. Notes are moved to the parent or fallback notebook, not deleted. Requires the exact name.',
    inputSchema: z.object({
      id: z.string().min(1).max(100),
      confirm_name: z.string().min(1).max(80),
    }),
    annotations: { ...writeAnnotations, destructiveHint: true },
  }, async (input) => toolResult(await service.deleteNotebook(input.id, input.confirm_name)))

  return server
}
