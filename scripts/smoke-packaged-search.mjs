import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'

const appPath = path.resolve(
  process.argv[2] ?? `release/mac-${process.arch}/Folio.app`,
)
const resourcesPath = path.join(appPath, 'Contents', 'Resources')
const nodePath = path.join(resourcesPath, 'runtime', 'node')
const workerPath = path.join(resourcesPath, 'app', 'dist-electron', 'qmd-worker.cjs')
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'folio-package-smoke-'))
const vaultPath = path.join(temporaryDirectory, 'vault')
const dbPath = path.join(temporaryDirectory, 'search', 'qmd-index.sqlite')

await mkdir(vaultPath, { recursive: true })

const child = spawn(nodePath, [workerPath], {
  cwd: path.dirname(workerPath),
  env: {
    ...process.env,
    LLAMA_LOG_LEVEL: 'error',
    GGML_LOG_LEVEL: 'error',
    GGML_BACKEND_SILENT: '1',
  },
  stdio: ['pipe', 'pipe', 'pipe'],
})

let stderr = ''
child.stderr.on('data', (chunk) => {
  stderr += chunk.toString()
})

const timeout = setTimeout(() => {
  child.kill()
}, 30_000)

try {
  await new Promise((resolve, reject) => {
    const lines = createInterface({ input: child.stdout, terminal: false })
    lines.on('line', (line) => {
      const message = JSON.parse(line)
      if (message.kind !== 'response') return
      if (message.error) {
        reject(new Error(message.error))
        return
      }
      if (message.id === 1) {
        child.stdin.write(`${JSON.stringify({ id: 2, type: 'close' })}\n`)
      } else if (message.id === 2) {
        resolve()
      }
    })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code !== 0) reject(new Error(`Packaged search worker exited with ${code}: ${stderr}`))
    })
    child.stdin.write(`${JSON.stringify({
      id: 1,
      type: 'init',
      vaultPath,
      dbPath,
    })}\n`)
  })
  console.log('Packaged qmd worker opened SQLite and initialized successfully.')
} finally {
  clearTimeout(timeout)
  if (!child.killed) child.kill()
  await rm(temporaryDirectory, { recursive: true, force: true })
}
