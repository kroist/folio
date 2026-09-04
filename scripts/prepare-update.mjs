import { execFileSync } from 'node:child_process'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const updateDirectory = path.join(root, 'build', 'update')
const payloadDirectory = path.join(updateDirectory, 'payload')
const archivePath = path.join(updateDirectory, `Folio-${packageJson.version}-update.zip`)

await rm(updateDirectory, { recursive: true, force: true })
await mkdir(payloadDirectory, { recursive: true })
await Promise.all([
  cp(path.join(root, 'dist'), path.join(payloadDirectory, 'dist'), { recursive: true }),
  cp(path.join(root, 'dist-electron'), path.join(payloadDirectory, 'dist-electron'), { recursive: true }),
])
await rm(path.join(payloadDirectory, 'dist-electron', 'bootstrap.cjs'))
await writeFile(
  path.join(payloadDirectory, 'manifest.json'),
  `${JSON.stringify({ version: packageJson.version })}\n`,
)
execFileSync('/usr/bin/ditto', ['-c', '-k', payloadDirectory, archivePath])
console.log(`Prepared ${archivePath}`)
