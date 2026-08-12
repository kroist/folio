import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline'
import type { QMDStore, SearchResult as QmdResult } from '@tobilu/qmd'
import { fuseSearchResults } from './search-ranking'
import type { NoteSearchResult, SearchInput, SearchMode, SearchStatus } from './types'

type WorkerRequest =
  | { id: number; type: 'init'; vaultPath: string; dbPath: string }
  | { id: number; type: 'refresh'; embed: boolean }
  | { id: number; type: 'search'; input: SearchInput }
  | { id: number; type: 'close' }

interface WorkerResponse {
  kind: 'response'
  id: number
  result?: unknown
  error?: string
}

interface WorkerStatus {
  kind: 'status'
  status: SearchStatus
}

let store: QMDStore | null = null
let semanticRequested = false

const writeMessage = (message: WorkerResponse | WorkerStatus): void => {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

const emitStatus = (status: SearchStatus): void => writeMessage({ kind: 'status', status })

const noteIdFromBody = (body: string | undefined): string | null => {
  if (!body) return null
  const match = /^id:\s*(.+)$/m.exec(body)
  if (!match) return null
  try {
    const id = JSON.parse(match[1]) as unknown
    return typeof id === 'string' ? id : null
  } catch {
    return match[1].trim() || null
  }
}

const withoutFrontmatter = (body: string): string =>
  body.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')

const cleanSnippet = (snippet: string): string =>
  snippet
    .replace(/^@@[^\n]*(?:\n|$)/, '')
    .replace(/```[\s\S]*?```/g, ' code ')
    .replace(/[#>*_`~\-[\]()!]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const mapResult = async (
  result: QmdResult,
  query: string,
  source: SearchMode,
): Promise<NoteSearchResult | null> => {
  if (!store) return null
  const fullBody = result.body ?? (await store.getDocumentBody(result.filepath)) ?? ''
  const noteId = noteIdFromBody(fullBody)
  if (!noteId) return null
  const body = withoutFrontmatter(fullBody)
  const { extractSnippet } = await import('@tobilu/qmd')
  const snippet = extractSnippet(body, query, 180, result.chunkPos).snippet
  return {
    noteId,
    score: result.score,
    snippet: cleanSnippet(snippet),
    source,
  }
}

const mapResults = async (
  results: QmdResult[],
  query: string,
  source: SearchMode,
): Promise<NoteSearchResult[]> => {
  const mapped = await Promise.all(results.map((result) => mapResult(result, query, source)))
  return mapped.filter((result): result is NoteSearchResult => result !== null)
}

const embedPendingNotes = async (): Promise<void> => {
  if (!store) throw new Error('Search index is not initialized')
  const status = await store.getStatus()
  if (status.needsEmbedding === 0 && status.hasVectorIndex) return

  emitStatus({
    state: 'embedding',
    semanticReady: false,
    message: 'Preparing the local embedding model…',
  })
  await store.embed({
    collection: 'folio',
    chunkStrategy: 'regex',
    onProgress: (progress) => {
      emitStatus({
        state: 'embedding',
        semanticReady: false,
        message: 'Embedding notes locally…',
        progress:
          progress.totalChunks > 0 ? progress.chunksEmbedded / progress.totalChunks : undefined,
      })
    },
  })
}

const refreshIndex = async (embed: boolean): Promise<void> => {
  if (!store) throw new Error('Search index is not initialized')
  emitStatus({
    state: 'indexing',
    semanticReady: false,
    message: 'Updating the search index…',
  })
  await store.update({ collections: ['folio'] })

  if (embed) await embedPendingNotes()

  const nextStatus = await store.getStatus()
  emitStatus({
    state: 'ready',
    semanticReady: nextStatus.hasVectorIndex && nextStatus.needsEmbedding === 0,
  })
}

const search = async (input: SearchInput): Promise<NoteSearchResult[]> => {
  if (!store) throw new Error('Search index is not initialized')
  const query = input.query.trim()
  if (!query) return []
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200)

  if (input.mode !== 'keyword') {
    semanticRequested = true
    await embedPendingNotes()
  }

  emitStatus({
    state: 'searching',
    semanticReady: semanticRequested,
    message: input.mode === 'keyword' ? 'Searching notes…' : 'Searching by meaning…',
  })

  if (input.mode === 'keyword') {
    const results = await store.searchLex(query, { limit, collection: 'folio' })
    return mapResults(results, query, 'keyword')
  }

  if (input.mode === 'semantic') {
    const results = await store.searchVector(query, { limit, collection: 'folio' })
    return mapResults(results, query, 'semantic')
  }

  const [keywordResults, semanticResults] = await Promise.all([
    store.searchLex(query, { limit, collection: 'folio' }),
    store.searchVector(query, { limit, collection: 'folio' }),
  ])
  return fuseSearchResults(
    await mapResults(keywordResults, query, 'keyword'),
    await mapResults(semanticResults, query, 'semantic'),
    limit,
  )
}

const handleRequest = async (request: WorkerRequest): Promise<unknown> => {
  if (request.type === 'init') {
    const { createStore } = await import('@tobilu/qmd')
    await mkdir(path.dirname(request.dbPath), { recursive: true })
    store = await createStore({
      dbPath: request.dbPath,
      config: {
        collections: {
          folio: {
            path: request.vaultPath,
            pattern: '**/*.md',
            ignore: ['.folio/**'],
          },
        },
      },
    })
    await refreshIndex(false)
    return { ready: true }
  }
  if (request.type === 'refresh') {
    await refreshIndex(request.embed || semanticRequested)
    return { ready: true }
  }
  if (request.type === 'search') return search(request.input)
  await store?.close()
  store = null
  return { closed: true }
}

const lines = createInterface({ input: process.stdin, terminal: false })
let queue = Promise.resolve()

lines.on('line', (line) => {
  queue = queue.then(async () => {
    let request: WorkerRequest
    try {
      request = JSON.parse(line) as WorkerRequest
    } catch {
      return
    }
    try {
      const result = await handleRequest(request)
      writeMessage({ kind: 'response', id: request.id, result })
      if (request.type === 'close') process.exit(0)
    } catch (error) {
      writeMessage({
        kind: 'response',
        id: request.id,
        error: error instanceof Error ? error.message : String(error),
      })
      emitStatus({
        state: 'error',
        semanticReady: false,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  })
})

process.on('SIGTERM', () => {
  void store?.close().finally(() => process.exit(0))
})
