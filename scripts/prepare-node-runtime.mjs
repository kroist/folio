import { spawnSync } from 'node:child_process'
import { chmod, copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

if (process.platform !== 'darwin') {
  throw new Error('The bundled Folio runtime can currently only be prepared on macOS.')
}

const destinationDirectory = path.resolve('build/runtime')
const destination = path.join(destinationDirectory, 'node')

await mkdir(destinationDirectory, { recursive: true })
await copyFile(process.execPath, destination)
await chmod(destination, 0o755)

const smokeTest = spawnSync(destination, [
  '-e',
  [
    "const Database = require('better-sqlite3')",
    "const sqliteVec = require('sqlite-vec')",
    "const database = new Database(':memory:')",
    'sqliteVec.load(database)',
    'database.close()',
  ].join(';'),
], {
  cwd: process.cwd(),
  encoding: 'utf8',
})

if (smokeTest.status !== 0) {
  throw new Error(`The qmd native runtime is not usable:\n${smokeTest.stderr || smokeTest.stdout}`)
}

console.log(`Bundled Node ${process.version} (${process.arch}) at ${destination}`)
