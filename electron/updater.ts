import { execFile } from 'node:child_process'
import { verify as verifySignature, type KeyLike } from 'node:crypto'
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import type { BrowserWindow, Dialog } from 'electron'
import updateKey from './update-key.json'

const RELEASE_API = 'https://api.github.com/repos/kroist/folio/releases/latest'
const STARTUP_CHECK_DELAY_MS = 15_000
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000
const MAX_UPDATE_SIZE = 100 * 1024 * 1024
const execFileAsync = promisify(execFile)
const versionPattern = /^v?(\d+)\.(\d+)\.(\d+)$/

interface GitHubAsset {
  name?: unknown
  browser_download_url?: unknown
  size?: unknown
}

interface GitHubRelease {
  tag_name?: unknown
  assets?: unknown
}

interface UpdateAsset {
  name: string
  url: string
  size: number
}

interface AvailableUpdate {
  version: string
  archive: UpdateAsset
  signature: UpdateAsset
}

interface FolioUpdaterOptions {
  dialog: Pick<Dialog, 'showMessageBox'>
  getWindow: () => BrowserWindow | null
  prepareToRestart: () => Promise<void>
  restart: () => void
  isPackaged: boolean
  platform: NodeJS.Platform
  version: string
  updateRoot?: string
}

export interface FolioUpdater {
  checkForUpdates: (manual?: boolean) => void
  start: () => void
  stop: () => void
}

const versionParts = (version: string): number[] | undefined => {
  const match = versionPattern.exec(version)
  return match?.slice(1).map(Number)
}

export const isNewerVersion = (candidate: string, current: string): boolean => {
  const left = versionParts(candidate)
  const right = versionParts(current)
  if (!left || !right) return false
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index]
  }
  return false
}

const readAsset = (asset: GitHubAsset): UpdateAsset | undefined => {
  if (
    typeof asset.name !== 'string' ||
    typeof asset.browser_download_url !== 'string' ||
    typeof asset.size !== 'number' ||
    asset.size <= 0
  ) return undefined
  return { name: asset.name, url: asset.browser_download_url, size: asset.size }
}

export const selectAvailableUpdate = (
  release: GitHubRelease,
  currentVersion: string,
): AvailableUpdate | undefined => {
  if (typeof release.tag_name !== 'string' || !Array.isArray(release.assets)) return undefined
  if (!isNewerVersion(release.tag_name, currentVersion)) return undefined
  const version = release.tag_name.replace(/^v/, '')
  const assets = release.assets.map((asset) => readAsset(asset as GitHubAsset)).filter(Boolean) as UpdateAsset[]
  const archive = assets.find((asset) => asset.name === `Folio-${version}-update.zip`)
  const signature = assets.find((asset) => asset.name === `Folio-${version}-update.zip.sig`)
  if (!archive || !signature) throw new Error(`Folio ${version} has no signed update payload.`)
  return { version, archive, signature }
}

export const hasValidUpdateSignature = (
  payload: Uint8Array,
  signature: Uint8Array,
  publicKey: KeyLike = updateKey.publicKey,
): boolean => signature.length === 64 && verifySignature(null, payload, publicKey, signature)

export const supportsAutomaticUpdates = (
  isPackaged: boolean,
  platform: NodeJS.Platform,
  updateRoot?: string,
): boolean => isPackaged && platform === 'darwin' && Boolean(updateRoot)

const fetchBytes = async (asset: UpdateAsset, maximumSize: number): Promise<Buffer> => {
  if (asset.size > maximumSize) throw new Error(`${asset.name} is larger than Folio allows.`)
  const url = new URL(asset.url)
  if (url.protocol !== 'https:') throw new Error(`${asset.name} does not use HTTPS.`)
  const response = await fetch(url, { headers: { 'User-Agent': 'Folio updater' } })
  if (!response.ok) throw new Error(`Could not download ${asset.name} (${response.status}).`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length !== asset.size || bytes.length > maximumSize) {
    throw new Error(`${asset.name} did not match its published size.`)
  }
  return bytes
}

const payloadIsValid = async (directory: string, version: string): Promise<boolean> => {
  try {
    const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8')) as {
      version?: unknown
    }
    if (manifest.version !== version) return false
    await Promise.all([
      access(path.join(directory, 'dist', 'index.html')),
      access(path.join(directory, 'dist-electron', 'main.cjs')),
      access(path.join(directory, 'dist-electron', 'preload.cjs')),
      access(path.join(directory, 'dist-electron', 'mcp-server.cjs')),
      access(path.join(directory, 'dist-electron', 'qmd-worker.cjs')),
    ])
    return true
  } catch {
    return false
  }
}

const stageUpdate = async (updateRoot: string, update: AvailableUpdate): Promise<void> => {
  const versionsRoot = path.join(updateRoot, 'versions')
  const versionDirectory = path.join(versionsRoot, update.version)
  const pendingPath = path.join(updateRoot, 'pending')
  const pendingTemporaryPath = `${pendingPath}.${process.pid}`
  await mkdir(versionsRoot, { recursive: true })

  if (!await payloadIsValid(versionDirectory, update.version)) {
    const [archive, encodedSignature] = await Promise.all([
      fetchBytes(update.archive, MAX_UPDATE_SIZE),
      fetchBytes(update.signature, 1_024),
    ])
    const signature = Buffer.from(encodedSignature.toString('utf8').trim(), 'base64')
    if (!hasValidUpdateSignature(archive, signature)) {
      throw new Error('The Folio update signature is invalid.')
    }

    const archivePath = path.join(updateRoot, `${update.version}.zip`)
    const stagingDirectory = path.join(versionsRoot, `${update.version}.staging`)
    await rm(stagingDirectory, { recursive: true, force: true })
    await writeFile(archivePath, archive, { mode: 0o600 })
    try {
      await execFileAsync('/usr/bin/ditto', ['-x', '-k', archivePath, stagingDirectory])
      if (!await payloadIsValid(stagingDirectory, update.version)) {
        throw new Error('The Folio update payload is incomplete.')
      }
      await rm(versionDirectory, { recursive: true, force: true })
      await rename(stagingDirectory, versionDirectory)
    } finally {
      await rm(archivePath, { force: true })
      await rm(stagingDirectory, { recursive: true, force: true })
    }
  }

  await writeFile(pendingTemporaryPath, `${update.version}\n`, { mode: 0o600 })
  await rename(pendingTemporaryPath, pendingPath)
}

export const createFolioUpdater = ({
  dialog,
  getWindow,
  prepareToRestart,
  restart,
  isPackaged,
  platform,
  version,
  updateRoot,
}: FolioUpdaterOptions): FolioUpdater => {
  const supported = supportsAutomaticUpdates(isPackaged, platform, updateRoot)
  let checkInProgress = false
  let startupTimer: NodeJS.Timeout | undefined
  let intervalTimer: NodeJS.Timeout | undefined

  const showMessage = async (options: Electron.MessageBoxOptions) => {
    const window = getWindow()
    return window && !window.isDestroyed()
      ? dialog.showMessageBox(window, options)
      : dialog.showMessageBox(options)
  }

  const performCheck = async (manual: boolean): Promise<void> => {
    if (!supported || !updateRoot) {
      if (manual) await showMessage({
        type: 'info',
        title: 'Updates are unavailable',
        message: 'Automatic updates are available in packaged macOS builds of Folio.',
        buttons: ['OK'],
      })
      return
    }
    if (checkInProgress) {
      if (manual) await showMessage({
        type: 'info',
        title: 'Checking for updates',
        message: 'Folio is already checking for an update.',
        buttons: ['OK'],
      })
      return
    }

    checkInProgress = true
    try {
      const response = await fetch(RELEASE_API, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'Folio updater',
        },
      })
      if (!response.ok) throw new Error(`GitHub returned ${response.status}.`)
      const update = selectAvailableUpdate(await response.json() as GitHubRelease, version)
      if (!update) {
        if (manual) await showMessage({
          type: 'info',
          title: 'Folio is up to date',
          message: `Folio ${version} is the newest available version.`,
          buttons: ['OK'],
        })
        return
      }

      if (manual) await showMessage({
        type: 'info',
        title: 'Folio update available',
        message: `Folio ${update.version} is available.`,
        detail: 'It is downloading in the background. Folio will let you know when it is ready.',
        buttons: ['OK'],
      })
      await stageUpdate(updateRoot, update)
      const { response: choice } = await showMessage({
        type: 'info',
        title: 'Folio update ready',
        message: `Folio ${update.version} is ready to install.`,
        detail: 'Restart Folio to finish the update. Your notes and settings will be preserved.',
        buttons: ['Later', 'Restart and Update'],
        defaultId: 1,
        cancelId: 0,
        noLink: true,
      })
      if (choice !== 1) return
      await prepareToRestart()
      restart()
    } catch (error) {
      console.warn('Folio update check failed.', error)
      if (manual) await showMessage({
        type: 'error',
        title: 'Could not check for updates',
        message: 'Folio could not check for or download an update.',
        detail: error instanceof Error ? error.message : 'Please try again.',
        buttons: ['OK'],
      })
    } finally {
      checkInProgress = false
    }
  }

  const checkForUpdates = (manual = false) => {
    void performCheck(manual).catch((error: unknown) => {
      console.warn('Could not show the Folio update prompt.', error)
    })
  }

  return {
    checkForUpdates,
    start: () => {
      if (!supported || startupTimer || intervalTimer) return
      startupTimer = setTimeout(() => {
        startupTimer = undefined
        checkForUpdates()
      }, STARTUP_CHECK_DELAY_MS)
      intervalTimer = setInterval(() => checkForUpdates(), UPDATE_CHECK_INTERVAL_MS)
      startupTimer.unref()
      intervalTimer.unref()
    },
    stop: () => {
      if (startupTimer) clearTimeout(startupTimer)
      if (intervalTimer) clearInterval(intervalTimer)
      startupTimer = undefined
      intervalTimer = undefined
    },
  }
}
