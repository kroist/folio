import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { InMemoryTransport, type JSONRPCMessage } from '@modelcontextprotocol/server'
import { afterEach, describe, expect, it } from 'vitest'
import { createFolioMcpServer, FolioMcpService } from './mcp'
import { LibraryStore } from './store'
import type { Note } from './types'

const temporaryDirectories: string[] = []

const makeService = async () => {
  const userDataPath = await mkdtemp(path.join(tmpdir(), 'folio-mcp-'))
  temporaryDirectories.push(userDataPath)
  const note: Note = {
    id: 'mcp-note-123456',
    notebookId: 'personal',
    title: 'Agent note',
    body: '# Plan\n\nOriginal sentence.\n',
    tags: ['agent'],
    pinned: false,
    createdAt: '2026-08-12T08:00:00.000Z',
    updatedAt: '2026-08-12T09:00:00.000Z',
  }
  await writeFile(path.join(userDataPath, 'library.json'), JSON.stringify({
    notebooks: [{ id: 'personal', name: 'Personal', icon: 'home' }],
    notes: [note],
  }), 'utf8')
  const store = new LibraryStore(userDataPath)
  await store.list()
  const service = new FolioMcpService({
    userDataPath,
    vaultPath: store.getVaultPath(),
  })
  await service.validate()
  return { service, note }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true })))
})

describe('Folio MCP service', () => {
  it('lists compact metadata and reads notes by id, path, or wiki link', async () => {
    const { service, note } = await makeService()
    const listed = await service.listNotes({ includeDescendants: true, limit: 100 })
    expect(listed.notes[0]).toMatchObject({ id: note.id, title: note.title })
    expect(listed.notes[0].path).toMatch(/^Personal\/Agent note--/)

    await expect(service.getNote(note.id, 0, 100)).resolves.toMatchObject({
      body: note.body,
      nextOffset: null,
    })
    await expect(service.getNote(listed.notes[0].wikiLink, 0, 100)).resolves.toMatchObject({
      body: note.body,
    })
  })

  it('guards edits against stale versions and supports exact replacement and append', async () => {
    const { service, note } = await makeService()
    const replaced = await service.replaceNoteText({
      reference: note.id,
      expectedUpdatedAt: note.updatedAt,
      oldText: 'Original sentence.',
      newText: 'Revised sentence.',
      replaceAll: false,
    })
    expect(replaced.replacements).toBe(1)

    await expect(service.appendToNote(note.id, note.updatedAt, 'Stale append', '\n\n'))
      .rejects.toThrow('changed since it was read')
    const current = await service.getNote(note.id, 0, 1_000)
    const appended = await service.appendToNote(
      note.id,
      current.note.updatedAt,
      '## Added by agent',
      '\n\n',
    )
    expect(appended.appendedCharacters).toBe('## Added by agent'.length)
    await expect(service.getNote(note.id, 0, 1_000)).resolves.toMatchObject({
      body: expect.stringContaining('Revised sentence.\n\n## Added by agent'),
    })
  })

  it('uses local keyword fallback and makes deletion explicit and recoverable', async () => {
    const { service, note } = await makeService()
    const search = await service.searchNotes('Original sentence', 'keyword', 10)
    expect(search.matches[0]).toMatchObject({ note: { id: note.id }, source: 'keyword' })

    await expect(service.deleteNote(note.id, note.updatedAt, 'Wrong title'))
      .rejects.toThrow('confirm_title')
    const deleted = await service.deleteNote(note.id, note.updatedAt, note.title)
    expect(deleted).toMatchObject({ deleted: true, recoverableFromTrash: true })
    expect((await service.listNotes({ includeDescendants: true, limit: 100 })).notes).toEqual([])
  })

  it('advertises annotated tools and serves structured results over MCP', async () => {
    const { service } = await makeService()
    const server = createFolioMcpServer(service)
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    const messages: JSONRPCMessage[] = []
    clientTransport.onmessage = (message) => messages.push(message)
    await clientTransport.start()
    await server.connect(serverTransport)

    const request = async (id: number, method: string, params: Record<string, unknown>) => {
      await clientTransport.send({ jsonrpc: '2.0', id, method, params })
      for (let attempts = 0; attempts < 100; attempts += 1) {
        const response = messages.find((message) => 'id' in message && message.id === id)
        if (response) return response
        await new Promise((resolve) => setTimeout(resolve, 1))
      }
      throw new Error(`No MCP response for ${method}`)
    }

    await request(1, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'folio-test', version: '1.0.0' },
    })
    await clientTransport.send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    const toolsResponse = await request(2, 'tools/list', {})
    expect(toolsResponse).toHaveProperty('result.tools')
    const tools = 'result' in toolsResponse
      ? (toolsResponse.result as { tools: Array<{ name: string; annotations?: object }> }).tools
      : []
    expect(tools.find((tool) => tool.name === 'get_note')?.annotations)
      .toMatchObject({ readOnlyHint: true, destructiveHint: false })
    expect(tools.find((tool) => tool.name === 'delete_note')?.annotations)
      .toMatchObject({ readOnlyHint: false, destructiveHint: true })

    const statusResponse = await request(3, 'tools/call', {
      name: 'vault_status',
      arguments: {},
    })
    expect(statusResponse).toHaveProperty('result.structuredContent.noteCount', 1)

    await clientTransport.close()
    await server.close()
    await service.close()
  })
})
