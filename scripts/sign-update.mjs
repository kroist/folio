import { execFileSync } from 'node:child_process'
import { createPrivateKey, sign, verify } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const { publicKey } = JSON.parse(await readFile(path.join(root, 'electron', 'update-key.json'), 'utf8'))
const archivePath = path.resolve(
  process.argv[2] ?? path.join(root, 'build', 'update', `Folio-${packageJson.version}-update.zip`),
)
const storedPrivateKey = process.env.FOLIO_UPDATE_PRIVATE_KEY ?? execFileSync('/usr/bin/security', [
  'find-generic-password',
  '-a',
  'kroist/folio',
  '-s',
  'com.folio.markdown-editor.update-signing',
  '-w',
], { encoding: 'utf8' }).trim()
const privateKey = storedPrivateKey.includes('BEGIN PRIVATE KEY')
  ? storedPrivateKey
  : createPrivateKey({ key: Buffer.from(storedPrivateKey, 'base64'), format: 'der', type: 'pkcs8' })
const signaturePath = `${archivePath}.sig`
const archive = await readFile(archivePath)
const signature = sign(null, archive, privateKey)

if (!verify(null, archive, publicKey, signature)) {
  throw new Error('The Keychain private key does not match Folio’s committed update public key.')
}
await writeFile(signaturePath, `${signature.toString('base64')}\n`)
console.log(`Signed ${signaturePath}`)
