import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { LibraryData, Note } from './types'
import { LibraryStore, parseNoteFile } from './store'

const temporaryDirectories: string[] = []

const makeTemporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(tmpdir(), 'folio-store-'))
  temporaryDirectories.push(directory)
  return directory
}

const legacyNote: Note = {
  id: 'legacy-id-123456',
  notebookId: 'personal',
  title: 'Legacy note',
  body: '# Original body\n\nStill plain Markdown.\n',
  tags: ['migration'],
  pinned: true,
  createdAt: '2026-08-10T10:00:00.000Z',
  updatedAt: '2026-08-11T10:00:00.000Z',
}

const legacyLibrary: Omit<LibraryData, 'noteOrder'> = {
  notebooks: [
    { id: 'personal', name: 'Personal', icon: 'home' },
    { id: 'projects', name: 'Projects', icon: 'folder' },
  ],
  notes: [legacyNote],
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  )
})

describe('parseNoteFile', () => {
  it('keeps the Markdown body separate from JSON-compatible YAML frontmatter', () => {
    const content = `---
id: "note-1"
title: "Frontmatter title"
notebookId: "personal"
tags: ["one","two"]
pinned: true
createdAt: "2026-08-10T10:00:00.000Z"
updatedAt: "2026-08-11T10:00:00.000Z"
---
# Body

---
`

    expect(parseNoteFile(content)).toEqual({
      id: 'note-1',
      title: 'Frontmatter title',
      notebookId: 'personal',
      tags: ['one', 'two'],
      pinned: true,
      createdAt: '2026-08-10T10:00:00.000Z',
      updatedAt: '2026-08-11T10:00:00.000Z',
      body: '# Body\n\n---\n',
    })
  })
})

describe('LibraryStore Markdown vault', () => {
  it('migrates JSON, writes and moves Markdown notes, and deletes recoverably', async () => {
    const userDataPath = await makeTemporaryDirectory()
    const legacyPath = path.join(userDataPath, 'library.json')
    await writeFile(legacyPath, JSON.stringify(legacyLibrary), 'utf8')

    const store = new LibraryStore(userDataPath)
    const migrated = await store.list()
    expect(migrated).toMatchObject(legacyLibrary)
    expect(migrated.noteOrder.all).toEqual([legacyNote.id])

    const originalPath = path.join(
      store.getVaultPath(),
      'Personal',
      'Legacy note--legacy-id-12.md',
    )
    expect(await readFile(originalPath, 'utf8')).toContain('title: "Legacy note"')
    expect(await readFile(originalPath, 'utf8')).toContain(legacyNote.body)
    await expect(access(legacyPath)).resolves.toBeUndefined()

    const { note: saved } = await store.save({
      id: legacyNote.id,
      title: 'Renamed note',
      body: 'Updated body',
      notebookId: 'projects',
      tags: ['updated'],
      pinned: false,
    })
    const movedPath = path.join(
      store.getVaultPath(),
      'Projects',
      'Renamed note--legacy-id-12.md',
    )
    expect(saved.title).toBe('Renamed note')
    await expect(access(originalPath)).rejects.toThrow()
    expect(parseNoteFile(await readFile(movedPath, 'utf8')).body).toBe('Updated body')

    const reopened = new LibraryStore(userDataPath)
    expect((await reopened.list()).notes[0]).toMatchObject({
      id: legacyNote.id,
      title: 'Renamed note',
      body: 'Updated body',
      notebookId: 'projects',
    })

    await reopened.delete(legacyNote.id)
    expect((await reopened.list()).notes).toEqual([])
    await expect(access(movedPath)).rejects.toThrow()
    expect(await readdir(path.join(store.getVaultPath(), '.folio', 'trash'))).toHaveLength(1)
  })

  it('creates nested notebook directories and moves their trees when renamed', async () => {
    const userDataPath = await makeTemporaryDirectory()
    await writeFile(path.join(userDataPath, 'library.json'), JSON.stringify(legacyLibrary), 'utf8')
    const store = new LibraryStore(userDataPath)

    const child = await store.createNotebook({
      name: 'Folio',
      icon: 'code',
      parentId: 'projects',
    })
    const note = await store.create({ notebookId: child.id, title: 'Nested note' })
    await store.save({ ...legacyNote, body: 'See [[Projects/Folio/Nested note]].' })
    const originalPath = path.join(
      store.getVaultPath(),
      'Projects',
      'Folio',
      `Nested note--${note.id.slice(0, 12)}.md`,
    )
    await expect(access(originalPath)).resolves.toBeUndefined()

    const renamedData = await store.updateNotebook({ id: 'projects', name: 'Work', icon: 'briefcase' })
    const movedPath = path.join(
      store.getVaultPath(),
      'Work',
      'Folio',
      `Nested note--${note.id.slice(0, 12)}.md`,
    )
    await expect(access(originalPath)).rejects.toThrow()
    await expect(access(movedPath)).resolves.toBeUndefined()
    expect(renamedData.notes.find((item) => item.id === legacyNote.id)?.body).toBe(
      `See [[Work/Folio/Nested note--${note.id.slice(0, 12)}.md]].`,
    )

    const reparentedData = await store.moveNotebook({ id: child.id, parentId: 'personal' })
    const reparentedPath = path.join(
      store.getVaultPath(),
      'Personal',
      'Folio',
      `Nested note--${note.id.slice(0, 12)}.md`,
    )
    await expect(access(movedPath)).rejects.toThrow()
    await expect(access(reparentedPath)).resolves.toBeUndefined()
    expect(reparentedData.notes.find((item) => item.id === legacyNote.id)?.body).toBe(
      `See [[Personal/Folio/Nested note--${note.id.slice(0, 12)}.md]].`,
    )

    const data = await store.deleteNotebook(child.id)
    expect(data.notebooks.some((notebook) => notebook.id === child.id)).toBe(false)
    expect(data.notes.find((item) => item.id === note.id)?.notebookId).toBe('personal')
    expect(data.notes.find((item) => item.id === legacyNote.id)?.body).toBe(
      `See [[Personal/Nested note--${note.id.slice(0, 12)}.md]].`,
    )
    await expect(access(path.join(store.getVaultPath(), 'Personal', `Nested note--${note.id.slice(0, 12)}.md`))).resolves.toBeUndefined()
  })

  it('returns unique vault-relative paths for notes and notebooks', async () => {
    const userDataPath = await makeTemporaryDirectory()
    await writeFile(path.join(userDataPath, 'library.json'), JSON.stringify(legacyLibrary), 'utf8')
    const store = new LibraryStore(userDataPath)
    await store.list()

    await expect(store.itemPath('notebook', 'projects')).resolves.toMatchObject({
      relativePath: 'Projects',
    })
    await expect(store.itemPath('note', legacyNote.id)).resolves.toMatchObject({
      relativePath: 'Personal/Legacy note--legacy-id-12.md',
    })
    await expect(store.itemPath('note', 'missing')).rejects.toThrow('Note not found')
  })

  it('persists independent manual orders for all notes, notebooks, and pinned notes', async () => {
    const userDataPath = await makeTemporaryDirectory()
    await writeFile(path.join(userDataPath, 'library.json'), JSON.stringify(legacyLibrary), 'utf8')
    const store = new LibraryStore(userDataPath)
    const second = await store.create({ notebookId: 'personal', title: 'Second' })
    await store.save({ ...second, pinned: true })

    await store.reorderNotes({
      scope: 'all',
      noteId: legacyNote.id,
      targetId: second.id,
      placement: 'before',
    })
    await store.reorderNotes({
      scope: 'pinned',
      noteId: second.id,
      targetId: legacyNote.id,
      placement: 'before',
    })
    await store.reorderNotes({
      scope: 'personal',
      noteId: second.id,
      targetId: legacyNote.id,
      placement: 'after',
    })

    const order = await store.getNoteOrder()
    expect(order.all).toEqual([legacyNote.id, second.id])
    expect(order.pinned).toEqual([second.id, legacyNote.id])
    expect(order.notebooks.personal).toEqual([legacyNote.id, second.id])

    const storedOrder = JSON.parse(
      await readFile(path.join(store.getVaultPath(), '.folio', 'note-order.json'), 'utf8'),
    )
    expect(storedOrder).toEqual(order)
    expect((await new LibraryStore(userDataPath).list()).noteOrder).toEqual(order)
  })

  it('stores note attachments relatively and moves and deletes them with the note', async () => {
    const userDataPath = await makeTemporaryDirectory()
    await writeFile(path.join(userDataPath, 'library.json'), JSON.stringify(legacyLibrary), 'utf8')
    const store = new LibraryStore(userDataPath)
    await store.list()

    const attachment = await store.saveAttachment({
      noteId: legacyNote.id,
      name: 'Lake photo.png',
      mimeType: 'image/png',
      data: new Uint8Array([137, 80, 78, 71]),
    })
    expect(attachment.relativePath).toMatch(
      /^\.attachments\/legacy-id-123456\/Lake-photo-[\da-f]{8}\.png$/,
    )
    await expect(
      store.readAttachmentDataUrl(legacyNote.id, attachment.relativePath),
    ).resolves.toBe('data:image/png;base64,iVBORw==')

    await store.save({ ...legacyNote, notebookId: 'projects' })
    const movedAttachmentPath = path.join(
      store.getVaultPath(),
      'Projects',
      ...attachment.relativePath.split('/'),
    )
    await expect(access(movedAttachmentPath)).resolves.toBeUndefined()
    await expect(
      store.readAttachmentDataUrl(legacyNote.id, attachment.relativePath),
    ).resolves.toContain('data:image/png;base64,')

    await store.delete(legacyNote.id)
    await expect(access(movedAttachmentPath)).rejects.toThrow()
    expect(
      (await readdir(path.join(store.getVaultPath(), '.folio', 'trash')))
        .some((name) => name.includes('attachments-legacy-id-123456')),
    ).toBe(true)
  })

  it('rewrites wiki-link targets when a note title changes', async () => {
    const userDataPath = await makeTemporaryDirectory()
    await writeFile(path.join(userDataPath, 'library.json'), JSON.stringify(legacyLibrary), 'utf8')
    const store = new LibraryStore(userDataPath)
    const reference = await store.create({ notebookId: 'personal', title: 'Reference' })
    await store.save({
      ...reference,
      body: 'Read [[Legacy note]] and [[legacy NOTE|the original]].',
    })

    const result = await store.save({
      ...legacyNote,
      title: 'Renamed note',
    })

    expect(result.linkedNotes).toHaveLength(1)
    expect(result.linkedNotes[0].body).toBe(
      'Read [[Personal/Renamed note--legacy-id-12.md]] and [[Personal/Renamed note--legacy-id-12.md|the original]].',
    )
    expect((await store.list()).notes.find((note) => note.id === reference.id)?.body).toBe(
      'Read [[Personal/Renamed note--legacy-id-12.md]] and [[Personal/Renamed note--legacy-id-12.md|the original]].',
    )
  })

  it('moves the canonical vault and exports and restores readable backups', async () => {
    const userDataPath = await makeTemporaryDirectory()
    await writeFile(path.join(userDataPath, 'library.json'), JSON.stringify(legacyLibrary), 'utf8')
    const store = new LibraryStore(userDataPath)
    await store.list()

    await writeFile(
      path.join(store.getVaultPath(), '.folio', 'qmd-index.sqlite'),
      'derived search data',
      'utf8',
    )
    const backupPath = path.join(userDataPath, 'exported-backup')
    await store.exportBackup(backupPath)
    expect(await readFile(path.join(backupPath, '.folio', 'library.json'), 'utf8')).toContain(
      '"notebooks"',
    )
    await expect(access(path.join(backupPath, '.folio', 'qmd-index.sqlite'))).rejects.toThrow()

    await store.save({ ...legacyNote, body: 'Changed after backup' })
    const safetyBackupPath = path.join(userDataPath, 'before-restore')
    await store.restoreBackup(backupPath, safetyBackupPath)
    expect((await store.list()).notes[0].body).toBe(legacyNote.body)
    expect(
      parseNoteFile(
        await readFile(
          path.join(safetyBackupPath, 'Personal', 'Legacy note--legacy-id-12.md'),
          'utf8',
        ),
      ).body,
    ).toBe('Changed after backup')

    const previousVaultPath = store.getVaultPath()
    const movedVaultPath = path.join(userDataPath, 'iCloud Drive', 'Folio')
    await store.moveVault(movedVaultPath)
    expect(store.getVaultPath()).toBe(movedVaultPath)
    await expect(access(previousVaultPath)).rejects.toThrow()
    await expect(access(path.join(movedVaultPath, '.folio', 'library.json'))).resolves.toBeUndefined()
  })

  it('adopts an existing synced vault without merging and preserves the previous vault', async () => {
    const root = await makeTemporaryDirectory()
    const currentUserDataPath = path.join(root, 'current')
    const syncedUserDataPath = path.join(root, 'synced-source')
    await Promise.all([
      mkdir(currentUserDataPath, { recursive: true }),
      mkdir(syncedUserDataPath, { recursive: true }),
    ])
    await writeFile(
      path.join(currentUserDataPath, 'library.json'),
      JSON.stringify(legacyLibrary),
      'utf8',
    )
    await writeFile(
      path.join(syncedUserDataPath, 'library.json'),
      JSON.stringify({ ...legacyLibrary, notes: [{ ...legacyNote, body: 'From iCloud' }] }),
      'utf8',
    )
    const current = new LibraryStore(currentUserDataPath)
    const synced = new LibraryStore(syncedUserDataPath)
    await current.list()
    await synced.list()
    const syncedVaultPath = synced.getVaultPath()
    const previousVaultPath = current.getVaultPath()
    const safetyBackupPath = path.join(root, 'switch-safety')

    expect(await current.adoptVault(syncedVaultPath, safetyBackupPath)).toBe(safetyBackupPath)
    expect(current.getVaultPath()).toBe(syncedVaultPath)
    expect((await current.list()).notes[0].body).toBe('From iCloud')
    await expect(access(previousVaultPath)).rejects.toThrow()
    await expect(
      access(path.join(safetyBackupPath, 'Personal', 'Legacy note--legacy-id-12.md')),
    ).resolves.toBeUndefined()
  })
})
