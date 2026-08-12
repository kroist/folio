import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { homedir } from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'
import type { NoteSearchResult, SearchInput, SearchStatus } from './types'

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

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

export class QmdSearchService {
  private child: ChildProcessWithoutNullStreams | null = null
  private startPromise: Promise<void> | null = null
  private readonly pending = new Map<number, PendingRequest>()
  private requestId = 0
  private dirty = false
  private queue = Promise.resolve()

  constructor(
    private readonly vaultPath: string,
    private readonly dbPath: string,
    private readonly workerPath: string,
    private readonly onStatus: (status: SearchStatus) => void,
    private readonly nodeExecutable = 'node',
  ) {}

  search(input: SearchInput): Promise<NoteSearchResult[]> {
    const operation = this.queue.then(async () => {
      await this.ensureStarted()
      if (this.dirty) {
        await this.send('refresh', { embed: input.mode !== 'keyword' })
        this.dirty = false
      }
      return this.send('search', { input }) as Promise<NoteSearchResult[]>
    })
    this.queue = operation.then(
      () => undefined,
      () => undefined,
    )
    return operation
  }

  markDirty(): void {
    this.dirty = true
  }

  async close(): Promise<void> {
    if (!this.child) return
    try {
      await this.send('close', {})
    } catch {
      this.child.kill()
    }
    this.child = null
    this.startPromise = null
  }

  private async ensureStarted(): Promise<void> {
    if (!this.startPromise) this.startPromise = this.start()
    await this.startPromise
  }

  private async start(): Promise<void> {
    const nodePaths = [
      path.join(homedir(), '.local', 'bin'),
      path.join(homedir(), '.hermes', 'node', 'bin'),
      path.join(homedir(), '.nvm', 'current', 'bin'),
      '/opt/homebrew/bin',
      '/usr/local/bin',
      process.env.PATH ?? '',
    ]
    this.child = spawn(this.nodeExecutable, [this.workerPath], {
      cwd: path.dirname(this.workerPath),
      env: {
        ...process.env,
        PATH: nodePaths.join(path.delimiter),
        LLAMA_LOG_LEVEL: 'error',
        GGML_LOG_LEVEL: 'error',
        GGML_BACKEND_SILENT: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const output = createInterface({ input: this.child.stdout, terminal: false })
    output.on('line', (line) => this.handleLine(line))
    this.child.stderr.on('data', (chunk: Buffer) => {
      const message = chunk.toString().trim()
      if (message) console.warn(`[qmd] ${message}`)
    })
    this.child.on('error', (error) => this.handleExit(error))
    this.child.on('exit', (code) => {
      if (code !== 0 && this.child) this.handleExit(new Error(`qmd worker exited with code ${code}`))
    })

    await this.send('init', {
      vaultPath: this.vaultPath,
      dbPath: this.dbPath,
    })
  }

  private handleLine(line: string): void {
    let message: WorkerResponse | WorkerStatus
    try {
      message = JSON.parse(line) as WorkerResponse | WorkerStatus
    } catch {
      console.warn(`[qmd] ${line}`)
      return
    }
    if (message.kind === 'status') {
      this.onStatus(message.status)
      return
    }
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)
    if (message.error) pending.reject(new Error(message.error))
    else pending.resolve(message.result)
  }

  private handleExit(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
    this.child = null
    this.startPromise = null
    this.onStatus({ state: 'error', semanticReady: false, message: error.message })
  }

  private send(type: string, payload: Record<string, unknown>): Promise<unknown> {
    if (!this.child) return Promise.reject(new Error('qmd worker is not running'))
    const id = ++this.requestId
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.child!.stdin.write(`${JSON.stringify({ id, type, ...payload })}\n`, (error) => {
        if (!error) return
        this.pending.delete(id)
        reject(error)
      })
    })
  }
}
