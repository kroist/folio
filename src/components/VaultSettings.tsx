import { Archive, Cloud, FolderOpen, HardDrive, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import type { VaultInfo } from '../types'

interface VaultSettingsProps {
  info: VaultInfo
  onMove: (storage: 'local' | 'icloud') => Promise<{
    canceled: boolean
    safetyBackupPath?: string
  }>
  onExport: () => Promise<string | undefined>
  onRestore: () => Promise<string | undefined>
  onShowInFinder: () => Promise<void>
}

export function VaultSettings({
  info,
  onMove,
  onExport,
  onRestore,
  onShowInFinder,
}: VaultSettingsProps) {
  const [busy, setBusy] = useState<'move' | 'export' | 'restore' | 'finder'>()
  const [message, setMessage] = useState<string>()
  const [error, setError] = useState<string>()

  const run = async (kind: NonNullable<typeof busy>, operation: () => Promise<string | void>) => {
    setBusy(kind)
    setError(undefined)
    setMessage(undefined)
    try {
      const result = await operation()
      if (result) setMessage(result)
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : 'The operation failed')
    } finally {
      setBusy(undefined)
    }
  }

  const isICloud = info.storage === 'icloud'

  return (
    <div className="vault-settings-panel">
        <div className="vault-location-card">
          <div className={`vault-location-icon${isICloud ? ' icloud' : ''}`}>
            {isICloud ? <Cloud size={21} /> : <HardDrive size={21} />}
          </div>
          <div className="vault-location-copy">
            <strong>{isICloud ? 'Synced with iCloud Drive' : 'Stored on this Mac'}</strong>
            <span title={info.path}>{info.path}</span>
          </div>
          <button
            className="secondary-button compact-button"
            disabled={Boolean(busy)}
            onClick={() => void run('finder', async () => {
              await onShowInFinder()
            })}
          >
            <FolderOpen size={14} /> Show
          </button>
        </div>

        <div className="vault-setting-row">
          <div>
            <strong>{isICloud ? 'Move back to this Mac' : 'Sync with iCloud Drive'}</strong>
            <p>
              {isICloud
                ? 'Keep the same vault but stop syncing it through iCloud Drive.'
                : 'Move the live vault into iCloud Drive so it stays synchronized.'}
            </p>
          </div>
          <button
            className="secondary-button"
            disabled={Boolean(busy) || (!isICloud && !info.iCloudAvailable)}
            onClick={() => void run('move', async () => {
              const result = await onMove(isICloud ? 'local' : 'icloud')
              if (result.canceled) return
              const status = isICloud ? 'Vault moved back to this Mac.' : 'Vault is now syncing with iCloud Drive.'
              return result.safetyBackupPath
                ? `${status} Previous vault saved to ${result.safetyBackupPath}`
                : status
            })}
          >
            {busy === 'move' ? 'Moving…' : isICloud ? 'Move to Mac' : 'Use iCloud'}
          </button>
        </div>
        {!isICloud && !info.iCloudAvailable && (
          <p className="vault-inline-note">iCloud Drive is not available. Enable it in macOS System Settings first.</p>
        )}

        <div className="vault-setting-row">
          <div>
            <strong>Export backup</strong>
            <p>Create a dated, readable copy of the complete vault.</p>
          </div>
          <button
            className="secondary-button"
            disabled={Boolean(busy)}
            onClick={() => void run('export', async () => {
              const backupPath = await onExport()
              return backupPath ? `Backup saved to ${backupPath}` : undefined
            })}
          >
            <Archive size={14} /> {busy === 'export' ? 'Exporting…' : 'Export…'}
          </button>
        </div>

        <div className="vault-setting-row">
          <div>
            <strong>Restore backup</strong>
            <p>Replace the vault from a backup. The current vault is backed up first.</p>
          </div>
          <button
            className="secondary-button"
            disabled={Boolean(busy)}
            onClick={() => void run('restore', async () => {
              const safetyPath = await onRestore()
              return safetyPath ? `Backup restored. Previous vault saved to ${safetyPath}` : undefined
            })}
          >
            <RotateCcw size={14} /> {busy === 'restore' ? 'Restoring…' : 'Restore…'}
          </button>
        </div>

        {message && <p className="vault-operation-message">{message}</p>}
        {error && <p className="vault-operation-error">{error}</p>}
    </div>
  )
}
