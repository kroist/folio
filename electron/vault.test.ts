import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { VaultLocations } from './vault'

const temporaryDirectories: string[] = []

const makeTemporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(tmpdir(), 'folio-vault-locations-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  )
})

describe('VaultLocations', () => {
  it('persists one canonical path and recognizes iCloud Drive storage', async () => {
    const root = await makeTemporaryDirectory()
    const userDataPath = path.join(root, 'user-data')
    const homePath = path.join(root, 'home')
    const locations = new VaultLocations(userDataPath, homePath)

    expect(await locations.readVaultPath()).toBe(path.join(userDataPath, 'vault'))
    expect((await locations.info(locations.localPath)).storage).toBe('local')
    expect((await locations.info(locations.localPath)).iCloudAvailable).toBe(false)

    await mkdir(locations.iCloudRoot, { recursive: true })
    await locations.writeVaultPath(locations.iCloudPath)
    expect(await locations.readVaultPath()).toBe(locations.iCloudPath)
    expect(await locations.info(locations.iCloudPath)).toEqual({
      path: locations.iCloudPath,
      storage: 'icloud',
      iCloudAvailable: true,
    })
  })

  it('moves the legacy qmd database out of the portable vault', async () => {
    const root = await makeTemporaryDirectory()
    const userDataPath = path.join(root, 'user-data')
    const locations = new VaultLocations(userDataPath, path.join(root, 'home'))
    const legacyPath = path.join(locations.localPath, '.folio', 'qmd-index.sqlite')
    await mkdir(path.dirname(legacyPath), { recursive: true })
    await writeFile(legacyPath, 'sqlite data', 'utf8')

    await locations.migrateLegacySearchIndex(locations.localPath)

    expect(await readFile(locations.searchIndexPath, 'utf8')).toBe('sqlite data')
    await expect(access(legacyPath)).rejects.toThrow()
  })
})
