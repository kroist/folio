import { cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { VaultInfo } from './types'

interface VaultPreferences {
  version: 1
  vaultPath: string
}

const exists = async (filePath: string): Promise<boolean> => {
  try {
    await stat(filePath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

const atomicWrite = async (filePath: string, content: string): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.tmp`
  await writeFile(temporaryPath, content, 'utf8')
  await rename(temporaryPath, filePath)
}

export class VaultLocations {
  readonly localPath: string
  readonly iCloudRoot: string
  readonly iCloudPath: string
  readonly searchIndexPath: string
  readonly mcpSearchIndexPath: string
  readonly restoreBackupsPath: string
  private readonly preferencesPath: string

  constructor(private readonly userDataPath: string, homePath: string) {
    this.localPath = path.join(userDataPath, 'vault')
    this.iCloudRoot = path.join(
      homePath,
      'Library',
      'Mobile Documents',
      'com~apple~CloudDocs',
    )
    this.iCloudPath = path.join(this.iCloudRoot, 'Folio')
    this.searchIndexPath = path.join(userDataPath, 'search', 'qmd-index.sqlite')
    this.mcpSearchIndexPath = path.join(userDataPath, 'search', 'mcp-qmd-index.sqlite')
    this.restoreBackupsPath = path.join(userDataPath, 'restore-backups')
    this.preferencesPath = path.join(userDataPath, 'vault-settings.json')
  }

  async readVaultPath(): Promise<string> {
    try {
      const parsed = JSON.parse(await readFile(this.preferencesPath, 'utf8')) as Partial<VaultPreferences>
      return parsed.version === 1 && typeof parsed.vaultPath === 'string' && path.isAbsolute(parsed.vaultPath)
        ? path.resolve(parsed.vaultPath)
        : this.localPath
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return this.localPath
      console.warn('Could not read vault settings; using the local vault.', error)
      return this.localPath
    }
  }

  async writeVaultPath(vaultPath: string): Promise<void> {
    const preferences: VaultPreferences = { version: 1, vaultPath: path.resolve(vaultPath) }
    await atomicWrite(this.preferencesPath, JSON.stringify(preferences, null, 2))
  }

  async info(vaultPath: string): Promise<VaultInfo> {
    const resolvedPath = path.resolve(vaultPath)
    const relativeToICloud = path.relative(this.iCloudRoot, resolvedPath)
    const inICloud = relativeToICloud === '' || (!relativeToICloud.startsWith('..') && !path.isAbsolute(relativeToICloud))
    return {
      path: resolvedPath,
      storage: inICloud ? 'icloud' : 'local',
      iCloudAvailable: await exists(this.iCloudRoot),
    }
  }

  pathExists(filePath: string): Promise<boolean> {
    return exists(filePath)
  }

  async migrateLegacySearchIndex(vaultPath: string): Promise<void> {
    const legacyPath = path.join(vaultPath, '.folio', 'qmd-index.sqlite')
    const suffixes = ['', '-shm', '-wal']
    await mkdir(path.dirname(this.searchIndexPath), { recursive: true })
    for (const suffix of suffixes) {
      const source = `${legacyPath}${suffix}`
      if (!(await exists(source))) continue
      const destination = `${this.searchIndexPath}${suffix}`
      if (!(await exists(destination))) {
        try {
          await rename(source, destination)
          continue
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
          await cp(source, destination, { errorOnExist: true })
        }
      }
      await rm(source)
    }
  }
}
