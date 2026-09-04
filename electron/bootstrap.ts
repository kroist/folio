import { cp, lstat, mkdir, readFile, readlink, rename, rm, symlink } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { app, dialog } from 'electron'
import { isNewerVersion } from './version'

const requirePayload = createRequire(__filename)
const versionPattern = /^\d+\.\d+\.\d+$/

if (!app.isPackaged) {
  requirePayload(path.join(__dirname, 'main.cjs'))
} else void app.whenReady().then(async () => {
  const updateRoot = path.join(app.getPath('userData'), 'updates')
  const versionsRoot = path.join(updateRoot, 'versions')
  const currentLink = path.join(updateRoot, 'current')
  const pendingPath = path.join(updateRoot, 'pending')
  const seedVersion = app.getVersion()

  const payloadVersion = async (directory: string): Promise<string> => {
    const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8')) as {
      version?: unknown
    }
    if (typeof manifest.version !== 'string' || !versionPattern.test(manifest.version)) {
      throw new Error('The Folio update manifest is invalid.')
    }
    await lstat(path.join(directory, 'dist-electron', 'main.cjs'))
    return manifest.version
  }

  const prepareVersion = async (version: string): Promise<string> => {
    if (!versionPattern.test(version)) throw new Error('The Folio update version is invalid.')
    const directory = path.join(versionsRoot, version)
    if (await payloadVersion(directory) !== version) throw new Error('The Folio update version does not match.')

    const modulesLink = path.join(directory, 'node_modules')
    try {
      const existing = await lstat(modulesLink)
      if (!existing.isSymbolicLink()) throw new Error('The Folio update contains an unexpected node_modules directory.')
      await rm(modulesLink)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await symlink(path.join(app.getAppPath(), 'node_modules'), modulesLink, 'dir')
    return directory
  }

  const activate = async (version: string): Promise<void> => {
    const directory = await prepareVersion(version)
    const temporaryLink = `${currentLink}.${process.pid}`
    await rm(temporaryLink, { force: true })
    await symlink(directory, temporaryLink, 'dir')
    await rename(temporaryLink, currentLink)
  }

  const currentVersion = async (): Promise<string | undefined> => {
    try {
      const target = await readlink(currentLink)
      const version = path.basename(target)
      const expectedDirectory = path.join(versionsRoot, version)
      if (
        !versionPattern.test(version) ||
        path.resolve(target) !== expectedDirectory ||
        await payloadVersion(expectedDirectory) !== version
      ) return undefined
      return version
    } catch {
      return undefined
    }
  }

  await mkdir(versionsRoot, { recursive: true })
  const seedDirectory = path.join(versionsRoot, seedVersion)
  try {
    await payloadVersion(seedDirectory)
  } catch {
    await rm(seedDirectory, { recursive: true, force: true })
    await cp(path.join(process.resourcesPath, 'update-seed'), seedDirectory, { recursive: true })
  }

  let previousVersion = await currentVersion()
  try {
    const pendingVersion = (await readFile(pendingPath, 'utf8')).trim()
    await activate(pendingVersion)
    await rm(pendingPath, { force: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('Could not activate the pending Folio update.', error)
      await rm(pendingPath, { force: true })
    }
  }

  const activeVersion = await currentVersion()
  if (!activeVersion || isNewerVersion(seedVersion, activeVersion)) await activate(seedVersion)
  const load = async (): Promise<void> => {
    const version = await currentVersion()
    if (!version) throw new Error('Folio has no active application payload.')
    process.env.FOLIO_UPDATE_ROOT = updateRoot
    process.env.FOLIO_PAYLOAD_CURRENT = currentLink
    process.env.FOLIO_PAYLOAD_VERSION = version
    requirePayload(path.join(currentLink, 'dist-electron', 'main.cjs'))
  }

  try {
    await load()
  } catch (error) {
    if (previousVersion && previousVersion !== await currentVersion()) {
      await activate(previousVersion)
      previousVersion = undefined
      await load()
      return
    }
    throw error
  }
}).catch((error: unknown) => {
  console.error('Folio could not start.', error)
  dialog.showErrorBox('Folio could not start', error instanceof Error ? error.message : 'The application payload is unavailable.')
  app.quit()
})
