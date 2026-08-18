import type { AutoUpdater, BrowserWindow, Dialog } from 'electron'

const UPDATE_SERVER = 'https://update.electronjs.org'
const UPDATE_REPOSITORY = 'kroist/folio'
const STARTUP_CHECK_DELAY_MS = 15_000
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000

interface FolioUpdaterOptions {
  autoUpdater: AutoUpdater
  dialog: Pick<Dialog, 'showMessageBox'>
  getWindow: () => BrowserWindow | null
  prepareToRestart: () => Promise<void>
  isPackaged: boolean
  platform: NodeJS.Platform
  arch: string
  version: string
}

export interface FolioUpdater {
  checkForUpdates: (manual?: boolean) => void
  start: () => void
  stop: () => void
}

export const buildUpdateFeedUrl = (
  platform: NodeJS.Platform,
  arch: string,
  version: string,
): string => `${UPDATE_SERVER}/${UPDATE_REPOSITORY}/${platform}-${arch}/${version}`

export const supportsAutomaticUpdates = (
  isPackaged: boolean,
  platform: NodeJS.Platform,
): boolean => isPackaged && platform === 'darwin'

export const createFolioUpdater = ({
  autoUpdater,
  dialog,
  getWindow,
  prepareToRestart,
  isPackaged,
  platform,
  arch,
  version,
}: FolioUpdaterOptions): FolioUpdater => {
  const supported = supportsAutomaticUpdates(isPackaged, platform)
  let checkInProgress = false
  let manualCheck = false
  let startupTimer: NodeJS.Timeout | undefined
  let intervalTimer: NodeJS.Timeout | undefined

  const showMessage = async (options: Electron.MessageBoxOptions) => {
    const window = getWindow()
    return window && !window.isDestroyed()
      ? dialog.showMessageBox(window, options)
      : dialog.showMessageBox(options)
  }

  const finishCheck = () => {
    checkInProgress = false
    manualCheck = false
  }

  autoUpdater.on('update-available', () => {
    if (!manualCheck) return
    void showMessage({
      type: 'info',
      title: 'Folio update available',
      message: 'A new version of Folio is available.',
      detail: 'It is downloading in the background. Folio will let you know when it is ready.',
      buttons: ['OK'],
    })
  })

  autoUpdater.on('update-not-available', () => {
    const shouldNotify = manualCheck
    finishCheck()
    if (!shouldNotify) return
    void showMessage({
      type: 'info',
      title: 'Folio is up to date',
      message: `Folio ${version} is the newest available version.`,
      buttons: ['OK'],
    })
  })

  autoUpdater.on('error', (error) => {
    const shouldNotify = manualCheck
    finishCheck()
    console.warn('Folio update check failed.', error)
    if (!shouldNotify) return
    void showMessage({
      type: 'error',
      title: 'Could not check for updates',
      message: 'Folio could not check for or download an update.',
      detail: error.message,
      buttons: ['OK'],
    })
  })

  autoUpdater.on('update-downloaded', (_event, _releaseNotes, releaseName) => {
    finishCheck()
    void showMessage({
      type: 'info',
      title: 'Folio update ready',
      message: `${releaseName || 'The latest version'} is ready to install.`,
      detail: 'Restart Folio to finish the update. Your notes and settings will be preserved.',
      buttons: ['Later', 'Restart and Update'],
      defaultId: 1,
      cancelId: 0,
      noLink: true,
    }).then(async ({ response }) => {
      if (response !== 1) return
      try {
        await prepareToRestart()
        autoUpdater.quitAndInstall()
      } catch (error) {
        await showMessage({
          type: 'error',
          title: 'Could not restart Folio',
          message: 'Folio could not finish saving before the update.',
          detail: error instanceof Error ? error.message : 'Please try again.',
          buttons: ['OK'],
        })
      }
    }).catch((error: unknown) => {
      console.warn('Could not show the Folio update prompt.', error)
    })
  })

  const checkForUpdates = (manual = false) => {
    if (!supported) {
      if (manual) {
        void showMessage({
          type: 'info',
          title: 'Updates are unavailable',
          message: 'Automatic updates are available in packaged macOS builds of Folio.',
          buttons: ['OK'],
        })
      }
      return
    }
    if (checkInProgress) {
      if (manual) {
        void showMessage({
          type: 'info',
          title: 'Checking for updates',
          message: 'Folio is already checking for an update.',
          buttons: ['OK'],
        })
      }
      return
    }

    checkInProgress = true
    manualCheck = manual
    try {
      autoUpdater.checkForUpdates()
    } catch (error) {
      const shouldNotify = manualCheck
      finishCheck()
      console.warn('Could not start the Folio update check.', error)
      if (shouldNotify) {
        void showMessage({
          type: 'error',
          title: 'Could not check for updates',
          message: 'Folio could not start the update check.',
          detail: error instanceof Error ? error.message : 'Please try again.',
          buttons: ['OK'],
        })
      }
    }
  }

  return {
    checkForUpdates,
    start: () => {
      if (!supported || startupTimer || intervalTimer) return
      autoUpdater.setFeedURL({ url: buildUpdateFeedUrl(platform, arch, version) })
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
