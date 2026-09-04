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
  body?: unknown
  assets?: unknown
}

interface UpdateAsset {
  name: string
  url: string
  size: number
}

interface AvailableUpdate {
  version: string
  releaseNotes: string
  archive: UpdateAsset
  signature: UpdateAsset
}

interface UpdatePreferences {
  automaticallyDownload?: boolean
  skippedVersion?: string
}

type UpdateAction = 'skip' | 'later' | 'install' | 'restart'

interface UpdateWindowAction {
  action: UpdateAction
  automaticallyDownload: boolean
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
  const releaseNotes = typeof release.body === 'string' && release.body.trim()
    ? release.body.trim()
    : `Folio ${version} includes improvements and fixes.`
  return { version, releaseNotes, archive, signature }
}

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
})[character]!)

const renderInlineReleaseNotes = (value: string): string => escapeHtml(value)
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/`(.+?)`/g, '<code>$1</code>')

export const renderReleaseNotes = (markdown: string): string => {
  const output: string[] = []
  let list: 'ul' | 'ol' | undefined
  const closeList = () => {
    if (list) output.push(`</${list}>`)
    list = undefined
  }

  for (const line of markdown.trim().split(/\r?\n/)) {
    const heading = /^(#{1,3})\s+(.+)$/.exec(line)
    const bullet = /^\s*[-*]\s+(.+)$/.exec(line)
    const numbered = /^\s*\d+\.\s+(.+)$/.exec(line)
    if (heading) {
      closeList()
      output.push(`<h3>${renderInlineReleaseNotes(heading[2])}</h3>`)
    } else if (bullet || numbered) {
      const nextList = bullet ? 'ul' : 'ol'
      if (list !== nextList) {
        closeList()
        list = nextList
        output.push(`<${list}>`)
      }
      output.push(`<li>${renderInlineReleaseNotes((bullet ?? numbered)![1])}</li>`)
    } else if (line.trim()) {
      closeList()
      output.push(`<p>${renderInlineReleaseNotes(line)}</p>`)
    }
  }
  closeList()
  return output.join('') || '<p>No release notes were provided.</p>'
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

const readPreferences = async (updateRoot: string): Promise<UpdatePreferences> => {
  try {
    const preferences = JSON.parse(await readFile(path.join(updateRoot, 'preferences.json'), 'utf8')) as unknown
    return preferences && typeof preferences === 'object' ? preferences as UpdatePreferences : {}
  } catch {
    return {}
  }
}

const writePreferences = async (
  updateRoot: string,
  preferences: UpdatePreferences,
): Promise<void> => {
  await writeFile(
    path.join(updateRoot, 'preferences.json'),
    `${JSON.stringify(preferences, null, 2)}\n`,
    { mode: 0o600 },
  )
}

export const updateWindowHtml = (
  update: AvailableUpdate,
  currentVersion: string,
  iconDataUrl: string,
  automaticallyDownload: boolean,
  initialState: 'available' | 'ready',
): string => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Folio Update</title>
  <style>
    :root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #f6f6f6; color: #202020; font-size: 14px; -webkit-user-select: none; }
    main { height: 100vh; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; gap: 18px; padding: 72px 32px 24px; }
    header { display: grid; grid-template-columns: 76px minmax(0, 1fr); align-items: center; gap: 20px; }
    .icon { width: 76px; height: 76px; border-radius: 18px; object-fit: contain; }
    .fallback-icon { display: none; place-items: center; background: #f2e9d6; color: #5c4b2d; font: 700 34px Georgia, serif; box-shadow: inset 0 0 0 1px #d9cdb7; }
    h1 { margin: 0 0 8px; font-size: 21px; line-height: 1.25; letter-spacing: -0.01em; }
    .summary { margin: 0; color: #333; font-size: 15px; line-height: 1.4; }
    .notes { min-height: 180px; overflow: auto; padding: 18px 22px; border: 1px solid #d4d4d4; border-radius: 10px; background: #fff; -webkit-user-select: text; }
    .notes h3 { margin: 0 0 12px; font-size: 20px; }
    .notes h3:not(:first-child) { margin-top: 18px; }
    .notes p { margin: 8px 0; line-height: 1.45; }
    .notes ul, .notes ol { margin: 8px 0; padding-left: 24px; }
    .notes li { margin: 5px 0; line-height: 1.4; }
    .notes code { padding: 1px 4px; border-radius: 4px; background: #ededed; font-family: ui-monospace, monospace; font-size: 12px; }
    footer { display: grid; gap: 14px; }
    .automatic { display: flex; align-items: center; gap: 8px; width: fit-content; }
    .automatic input { width: 16px; height: 16px; margin: 0; accent-color: #3478f6; }
    .actions { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 12px; }
    button { min-width: 138px; height: 36px; padding: 0 20px; border: 0; border-radius: 18px; background: #e4e4e4; color: #202020; font: inherit; }
    button:hover { background: #d9d9d9; }
    button:active { background: #cecece; }
    button.primary { background: #3478f6; color: white; }
    button.primary:hover { background: #286ee7; }
    button:focus-visible { outline: 3px solid color-mix(in srgb, #3478f6 45%, transparent); outline-offset: 2px; }
    .status { display: none; align-items: center; gap: 10px; color: #555; }
    progress { width: 180px; accent-color: #3478f6; }
    body.downloading .status { display: flex; }
    body.downloading .automatic, body.downloading .actions { visibility: hidden; }
    .skip { justify-self: start; }
    body.ready .automatic, body.ready .skip { display: none; }
    @media (prefers-color-scheme: dark) {
      body { background: #292929; color: #f2f2f2; }
      .summary, .status { color: #d0d0d0; }
      .notes { border-color: #505050; background: #343434; }
      .notes code { background: #484848; }
      button { background: #505050; color: #f2f2f2; }
      button:hover { background: #5c5c5c; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      ${iconDataUrl ? `<img class="icon" src="${iconDataUrl}" alt="">` : '<div class="icon fallback-icon" style="display:grid">F</div>'}
      <div>
        <h1 id="title">A new version of Folio is available!</h1>
        <p class="summary" id="summary">Folio ${escapeHtml(update.version)} is now available—you have ${escapeHtml(currentVersion)}.</p>
      </div>
    </header>
    <section class="notes">${renderReleaseNotes(update.releaseNotes)}</section>
    <footer>
      <label class="automatic"><input id="automatic" type="checkbox" ${automaticallyDownload ? 'checked' : ''}> Automatically download and install updates in the future</label>
      <div class="status"><progress></progress><span>Downloading and verifying the update…</span></div>
      <div class="actions">
        <button class="skip" data-action="skip">Skip This Version</button>
        <button data-action="later">Remind Me Later</button>
        <button class="primary" data-action="install" autofocus>Install Update</button>
      </div>
    </footer>
  </main>
  <script>
    const automatic = document.getElementById('automatic')
    const primary = document.querySelector('.primary')
    const later = document.querySelector('[data-action="later"]')
    for (const button of document.querySelectorAll('button')) button.addEventListener('click', () => {
      if (button.dataset.action === 'install') window.setUpdateState('downloading')
      location.href = 'folio-update-action://' + button.dataset.action + '?automatic=' + (automatic.checked ? '1' : '0')
    })
    addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !document.body.classList.contains('downloading')) later.click()
    })
    window.setUpdateState = (state) => {
      document.body.className = state
      if (state === 'downloading') {
        document.getElementById('title').textContent = 'Downloading Folio ${escapeHtml(update.version)}…'
        document.getElementById('summary').textContent = 'Folio will verify the update before installing it.'
      } else if (state === 'ready') {
        document.getElementById('title').textContent = 'Folio ${escapeHtml(update.version)} is ready to install'
        document.getElementById('summary').textContent = 'Restart Folio to finish the update. Your notes and settings will be preserved.'
        later.textContent = 'Later'
        primary.textContent = 'Restart and Update'
        primary.dataset.action = 'restart'
        primary.focus()
      }
    }
    ${initialState === 'ready' ? "window.setUpdateState('ready')" : ''}
  </script>
</body>
</html>`

const createUpdateWindow = async (
  update: AvailableUpdate,
  currentVersion: string,
  automaticallyDownload: boolean,
  getWindow: () => BrowserWindow | null,
  initialState: 'available' | 'ready' = 'available',
) => {
  const { app, BrowserWindow: ElectronBrowserWindow } = await import('electron')
  const parent = getWindow()
  const icon = await app.getFileIcon(path.resolve(process.execPath, '../../..'), { size: 'large' })
  const window = new ElectronBrowserWindow({
    width: 790,
    height: 610,
    minWidth: 680,
    minHeight: 500,
    show: false,
    title: 'Folio Update',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 17, y: 16 },
    backgroundColor: '#f6f6f6',
    ...(parent && !parent.isDestroyed() ? { parent } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.setMenuBarVisibility(false)

  const queuedActions: UpdateWindowAction[] = []
  let waiting: ((action: UpdateWindowAction) => void) | undefined
  const emit = (action: UpdateWindowAction) => {
    if (waiting) {
      const resolve = waiting
      waiting = undefined
      resolve(action)
    } else {
      queuedActions.push(action)
    }
  }
  const later = () => emit({ action: 'later', automaticallyDownload })

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, rawUrl) => {
    const url = new URL(rawUrl)
    if (url.protocol !== 'folio-update-action:') return
    event.preventDefault()
    const action = url.hostname as UpdateAction
    if (!['skip', 'later', 'install', 'restart'].includes(action)) return
    emit({ action, automaticallyDownload: url.searchParams.get('automatic') === '1' })
  })
  window.once('closed', later)
  window.once('ready-to-show', () => window.show())
  await window.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(updateWindowHtml(
    update,
    currentVersion,
    icon.isEmpty() ? '' : icon.resize({ width: 96, height: 96 }).toDataURL(),
    automaticallyDownload,
    initialState,
  ))}`)

  return {
    close: () => {
      if (!window.isDestroyed()) window.close()
    },
    nextAction: (): Promise<UpdateWindowAction> => {
      const queued = queuedActions.shift()
      return queued ? Promise.resolve(queued) : new Promise((resolve) => { waiting = resolve })
    },
    setState: async (state: 'downloading' | 'ready') => {
      if (!window.isDestroyed()) await window.webContents.executeJavaScript(`window.setUpdateState('${state}')`)
    },
  }
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
    let updateWindow: Awaited<ReturnType<typeof createUpdateWindow>> | undefined
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

      const preferences = await readPreferences(updateRoot)
      if (!manual && preferences.skippedVersion === update.version) return
      let automaticallyDownload = preferences.automaticallyDownload === true

      if (!automaticallyDownload || manual) {
        updateWindow = await createUpdateWindow(update, version, automaticallyDownload, getWindow)
        const choice = await updateWindow.nextAction()
        automaticallyDownload = choice.automaticallyDownload
        if (choice.action === 'skip') {
          await writePreferences(updateRoot, {
            automaticallyDownload,
            skippedVersion: update.version,
          })
          updateWindow.close()
          return
        }
        await writePreferences(updateRoot, { automaticallyDownload })
        if (choice.action !== 'install') {
          updateWindow.close()
          return
        }
        await updateWindow.setState('downloading')
      }

      await stageUpdate(updateRoot, update)
      if (updateWindow) {
        await updateWindow.setState('ready')
      } else {
        updateWindow = await createUpdateWindow(update, version, automaticallyDownload, getWindow, 'ready')
      }
      const choice = await updateWindow.nextAction()
      if (choice.action !== 'restart') {
        updateWindow.close()
        return
      }
      await prepareToRestart()
      restart()
    } catch (error) {
      console.warn('Folio update check failed.', error)
      updateWindow?.close()
      if (manual || updateWindow) await showMessage({
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
