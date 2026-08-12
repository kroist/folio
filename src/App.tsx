import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CommandPalette } from './components/CommandPalette'
import { EditorWorkspace } from './components/EditorWorkspace'
import { LibrarySidebar } from './components/LibrarySidebar'
import { NoteList } from './components/NoteList'
import { notebookDescendantIds, notebookPathLabel } from './lib/notebooks'
import { filterAndSortNotes } from './lib/notes'
import {
  parseThemePreference,
  resolveThemePreference,
  themeScheme,
  type ThemePreference,
} from './lib/themes'
import {
  LINE_WRAPPING_STORAGE_KEY,
  parseLineWrappingPreference,
} from './lib/editorPreferences'
import { findBacklinks, findNoteByWikiLink, wikiLinkCandidates } from './lib/wikiLinks'
import type {
  EditorMode,
  DraggedLibraryItem,
  LibraryData,
  LibraryScope,
  Note,
  NoteSort,
  NoteSearchResult,
  NoteUpdate,
  SearchMode,
  SearchStatus,
  VaultInfo,
} from './types'

const THEME_STORAGE_KEY = 'folio.theme'
const SEARCH_MODE_STORAGE_KEY = 'folio.search-mode'
const NOTE_SORT_STORAGE_KEY = 'folio.note-sort'

const readSearchMode = (): SearchMode => {
  const value = window.localStorage.getItem(SEARCH_MODE_STORAGE_KEY)
  return value === 'semantic' || value === 'hybrid' ? value : 'keyword'
}

const readThemePreference = (): ThemePreference => {
  try {
    return parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY))
  } catch {
    return 'system'
  }
}

const readNoteSort = (): NoteSort => {
  const value = window.localStorage.getItem(NOTE_SORT_STORAGE_KEY)
  return value === 'updated' || value === 'created' || value === 'title' ? value : 'manual'
}

const savePayload = (note: Note): NoteUpdate => ({
  id: note.id,
  title: note.title,
  body: note.body,
  notebookId: note.notebookId,
  tags: note.tags,
  pinned: note.pinned,
})

export function App() {
  const [library, setLibrary] = useState<LibraryData>({
    notebooks: [],
    notes: [],
    noteOrder: { version: 1, all: [], pinned: [], notebooks: {} },
  })
  const [selectedScope, setSelectedScope] = useState<LibraryScope>('all')
  const [selectedId, setSelectedId] = useState<string>()
  const [query, setQuery] = useState('')
  const [searchMode, setSearchMode] = useState<SearchMode>(readSearchMode)
  const [noteSort, setNoteSort] = useState<NoteSort>(readNoteSort)
  const [searchResults, setSearchResults] = useState<NoteSearchResult[]>()
  const [searchStatus, setSearchStatus] = useState<SearchStatus>({
    state: 'idle',
    semanticReady: false,
  })
  const [mode, setMode] = useState<EditorMode>('split')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [vaultInfo, setVaultInfo] = useState<VaultInfo>()
  const [themePreference, setThemePreference] = useState<ThemePreference>(readThemePreference)
  const [lineWrapping, setLineWrapping] = useState(() =>
    parseLineWrappingPreference(window.localStorage.getItem(LINE_WRAPPING_STORAGE_KEY)),
  )
  const [draggedLibraryItem, setDraggedLibraryItem] = useState<DraggedLibraryItem>()
  const [systemDark, setSystemDark] = useState(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches,
  )
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved')
  const hydrated = useRef(false)
  const savedSignatures = useRef(new Map<string, string>())
  const saveTimers = useRef(new Map<string, number>())
  const selectedIdRef = useRef(selectedId)
  const libraryRef = useRef(library)
  const searchRequestId = useRef(0)

  const resolvedTheme = resolveThemePreference(themePreference, systemDark)

  const replaceLibrary = useCallback((data: LibraryData) => {
    libraryRef.current = data
    savedSignatures.current = new Map(
      data.notes.map((note) => [note.id, JSON.stringify(savePayload(note))]),
    )
    setLibrary(data)
    setSelectedId((current) =>
      current && data.notes.some((note) => note.id === current) ? current : data.notes[0]?.id,
    )
  }, [])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme
    document.documentElement.style.colorScheme = themeScheme(resolvedTheme)
  }, [resolvedTheme])

  useEffect(() => {
    window.localStorage.setItem(THEME_STORAGE_KEY, themePreference)
  }, [themePreference])

  useEffect(() => {
    window.localStorage.setItem(SEARCH_MODE_STORAGE_KEY, searchMode)
  }, [searchMode])

  useEffect(() => {
    window.localStorage.setItem(NOTE_SORT_STORAGE_KEY, noteSort)
  }, [noteSort])

  useEffect(() => window.folio.onSearchStatus(setSearchStatus), [])
  useEffect(() => window.folio.onThemePreference((preference) => {
    setThemePreference(preference)
  }), [])
  useEffect(() => window.folio.onLineWrappingPreference((enabled) => {
    setLineWrapping(enabled)
    window.localStorage.setItem(LINE_WRAPPING_STORAGE_KEY, String(enabled))
  }), [])
  useEffect(() => window.folio.onVaultInfoChanged(setVaultInfo), [])

  useEffect(() => {
    selectedIdRef.current = selectedId
  }, [selectedId])

  useEffect(() => {
    libraryRef.current = library
  }, [library])

  useEffect(() => {
    void Promise.all([window.folio.listLibrary(), window.folio.getVaultInfo()]).then(([data, info]) => {
      replaceLibrary(data)
      setVaultInfo(info)
      hydrated.current = true
    })
  }, [replaceLibrary])

  useEffect(() => window.folio.onLibraryChanged((data) => {
    const currentId = selectedIdRef.current
    const currentNote = libraryRef.current.notes.find((note) => note.id === currentId)
    const savedSignature = currentNote ? savedSignatures.current.get(currentNote.id) : undefined
    const hasUnsavedChanges = currentNote
      ? savedSignature !== JSON.stringify(savePayload(currentNote))
      : false
    if (
      hasUnsavedChanges &&
      !window.confirm(
        'The vault changed outside Folio while this note has unsaved edits.\n\nReload the external version? Cancel keeps your draft, which will overwrite the external version when saved.',
      )
    ) return
    replaceLibrary(data)
    setSelectedScope((current) =>
      current === 'all' || current === 'pinned' || data.notebooks.some((item) => item.id === current)
        ? current
        : 'all',
    )
  }), [replaceLibrary])

  useEffect(() => {
    const normalizedQuery = query.trim()
    const requestId = ++searchRequestId.current
    if (!normalizedQuery) {
      setSearchResults(undefined)
      return
    }

    setSearchResults(undefined)
    const timeout = window.setTimeout(async () => {
      setSearchStatus((current) => ({
        ...current,
        state: 'searching',
        message: searchMode === 'keyword' ? 'Searching notes…' : 'Preparing local search…',
      }))
      try {
        const results = await window.folio.searchNotes({
          query: normalizedQuery,
          mode: searchMode,
          limit: 100,
        })
        if (searchRequestId.current !== requestId) return
        setSearchResults(results)
        setSearchStatus((current) => ({ ...current, state: 'ready', message: undefined }))
      } catch (error) {
        if (searchRequestId.current !== requestId) return
        console.error(error)
        setSearchStatus((current) => ({
          ...current,
          state: 'error',
          message: error instanceof Error ? error.message : 'Search is unavailable',
        }))
      }
    }, 180)
    return () => window.clearTimeout(timeout)
  }, [query, searchMode])

  const selectedNotebookIds = useMemo(
    () =>
      selectedScope !== 'all' && selectedScope !== 'pinned'
        ? notebookDescendantIds(library.notebooks, selectedScope)
        : undefined,
    [library.notebooks, selectedScope],
  )

  const visibleNotes = useMemo(() => {
    if (!query.trim() || searchResults === undefined) {
      const scopedNotes = selectedNotebookIds
        ? library.notes.filter((note) => selectedNotebookIds.has(note.notebookId))
        : library.notes
      return filterAndSortNotes(
        scopedNotes,
        selectedScope === 'pinned' ? 'pinned' : 'all',
        query,
        query.trim() ? 'updated' : noteSort,
        selectedScope === 'all'
          ? library.noteOrder.all
          : selectedScope === 'pinned'
            ? library.noteOrder.pinned
            : library.noteOrder.notebooks[selectedScope] ?? [],
      )
    }
    const notesById = new Map(library.notes.map((note) => [note.id, note]))
    return searchResults
      .map((result) => notesById.get(result.noteId))
      .filter((note): note is Note => {
        if (!note) return false
        if (selectedScope === 'pinned') return note.pinned
        return selectedScope === 'all' || selectedNotebookIds?.has(note.notebookId) === true
      })
  }, [library.noteOrder, library.notes, noteSort, query, searchResults, selectedNotebookIds, selectedScope])
  const searchSnippets = useMemo(
    () => new Map(searchResults?.map((result) => [result.noteId, result.snippet]) ?? []),
    [searchResults],
  )
  const selectedNote = library.notes.find((note) => note.id === selectedId)
  const linkCandidates = useMemo(
    () => wikiLinkCandidates(library.notes, library.notebooks),
    [library.notebooks, library.notes],
  )
  const backlinks = useMemo(
    () => (selectedNote ? findBacklinks(library.notes, selectedNote, library.notebooks) : []),
    [library.notebooks, library.notes, selectedNote],
  )

  const noteCounts = useMemo(() => {
    const counts: Record<string, number> = { all: library.notes.length, pinned: 0 }
    for (const note of library.notes) {
      if (note.pinned) counts.pinned += 1
    }
    for (const notebook of library.notebooks) {
      const ids = notebookDescendantIds(library.notebooks, notebook.id)
      counts[notebook.id] = library.notes.filter((note) => ids.has(note.notebookId)).length
    }
    return counts
  }, [library.notebooks, library.notes])

  const scopeTitle =
    selectedScope === 'all'
      ? 'All notes'
      : selectedScope === 'pinned'
        ? 'Pinned'
        : notebookPathLabel(library.notebooks, selectedScope) || 'Notes'

  const createNote = useCallback(async (title?: string, notebookIdOverride?: string) => {
    const notebookId =
      notebookIdOverride ?? (
        selectedScope !== 'all' && selectedScope !== 'pinned' ? selectedScope : undefined
      )
    const note = await window.folio.createNote({ notebookId, title })
    const noteOrder = await window.folio.getNoteOrder()
    savedSignatures.current.set(note.id, JSON.stringify(savePayload(note)))
    setLibrary((current) => ({ ...current, notes: [note, ...current.notes], noteOrder }))
    setSelectedId(note.id)
    setQuery('')
  }, [selectedScope])

  const createNotebook = async (name: string, icon: string, parentId?: string) => {
    const notebook = await window.folio.createNotebook({ name, icon, parentId })
    setLibrary((current) => ({ ...current, notebooks: [...current.notebooks, notebook] }))
    setSelectedScope(notebook.id)
    setQuery('')
  }

  const persistSelectedNote = useCallback(async () => {
    if (!selectedNote) return new Map<string, Note>()
    const signature = JSON.stringify(savePayload(selectedNote))
    if (savedSignatures.current.get(selectedNote.id) === signature) return new Map<string, Note>()
    const pendingSave = saveTimers.current.get(selectedNote.id)
    if (pendingSave) window.clearTimeout(pendingSave)
    saveTimers.current.delete(selectedNote.id)
    const result = await window.folio.saveNote(savePayload(selectedNote))
    const changedNotes = new Map(
      [result.note, ...result.linkedNotes].map((note) => [note.id, note]),
    )
    for (const note of changedNotes.values()) {
      savedSignatures.current.set(note.id, JSON.stringify(savePayload(note)))
    }
    setLibrary((current) => ({
      ...current,
      notes: current.notes.map((note) => changedNotes.get(note.id) ?? note),
      noteOrder: result.noteOrder,
    }))
    return changedNotes
  }, [selectedNote])

  const updateNotebook = async (id: string, name: string, icon: string) => {
    await persistSelectedNote()
    const data = await window.folio.updateNotebook({ id, name, icon })
    savedSignatures.current = new Map(
      data.notes.map((note) => [note.id, JSON.stringify(savePayload(note))]),
    )
    setLibrary(data)
  }

  const moveNotebook = async (id: string, parentId?: string) => {
    await persistSelectedNote()
    const data = await window.folio.moveNotebook({ id, parentId })
    savedSignatures.current = new Map(
      data.notes.map((note) => [note.id, JSON.stringify(savePayload(note))]),
    )
    setLibrary(data)
  }

  const moveNote = async (id: string, notebookId: string) => {
    const persistedChanges = await persistSelectedNote()
    const note = persistedChanges.get(id) ?? library.notes.find((item) => item.id === id)
    if (!note || note.notebookId === notebookId) return
    const pendingSave = saveTimers.current.get(id)
    if (pendingSave) window.clearTimeout(pendingSave)
    saveTimers.current.delete(id)
    const result = await window.folio.saveNote(savePayload({ ...note, notebookId }))
    const changedNotes = new Map(
      [result.note, ...result.linkedNotes].map((item) => [item.id, item]),
    )
    for (const changed of changedNotes.values()) {
      savedSignatures.current.set(changed.id, JSON.stringify(savePayload(changed)))
    }
    setLibrary((current) => ({
      ...current,
      notes: current.notes.map((item) => changedNotes.get(item.id) ?? item),
      noteOrder: result.noteOrder,
    }))
    setSelectedScope(notebookId)
    setQuery('')
  }

  const deleteNotebook = async (id: string) => {
    const notebook = library.notebooks.find((item) => item.id === id)
    if (!notebook) return
    const deletedIds = notebookDescendantIds(library.notebooks, id)
    const childCount = deletedIds.size - 1
    const noteCount = library.notes.filter((note) => deletedIds.has(note.notebookId)).length
    const destination = notebook.parentId
      ? library.notebooks.find((item) => item.id === notebook.parentId)?.name
      : library.notebooks.find((item) => !deletedIds.has(item.id))?.name ?? 'a new Notes notebook'
    const details = [
      childCount > 0 ? `${childCount} sub-notebook${childCount === 1 ? '' : 's'}` : '',
      noteCount > 0 ? `${noteCount} note${noteCount === 1 ? '' : 's'}` : '',
    ].filter(Boolean).join(' and ')
    const message = details
      ? `Delete “${notebook.name}” and its ${details}?\n\nIts notes will be moved to ${destination}. The notebook folder will remain recoverable in Folio’s trash.`
      : `Delete the empty notebook “${notebook.name}”?`
    if (!window.confirm(message)) return

    await persistSelectedNote()
    const data = await window.folio.deleteNotebook(id)
    savedSignatures.current = new Map(
      data.notes.map((note) => [note.id, JSON.stringify(savePayload(note))]),
    )
    setLibrary(data)
    if (selectedScope !== 'all' && selectedScope !== 'pinned' && deletedIds.has(selectedScope)) {
      setSelectedScope('all')
    }
  }

  const openNote = useCallback((id: string) => {
    setSelectedScope('all')
    setQuery('')
    setSelectedId(id)
  }, [])

  const searchNotes = useCallback(
    (input: Parameters<typeof window.folio.searchNotes>[0]) => window.folio.searchNotes(input),
    [],
  )

  const openWikiLink = useCallback(
    async (target: string) => {
      const existing = findNoteByWikiLink(
        library.notes,
        library.notebooks,
        target,
        selectedNote?.notebookId,
      )
      if (existing) {
        openNote(existing.id)
        return
      }
      await createNote(target.split('/').at(-1) || target)
    },
    [createNote, library.notebooks, library.notes, openNote, selectedNote?.notebookId],
  )

  const selectScope = useCallback((scope: LibraryScope) => {
    setSelectedScope(scope)
    setQuery('')
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (!event.metaKey) return
      if (event.key.toLowerCase() === 'k' && !event.shiftKey && !event.altKey) {
        event.preventDefault()
        setPaletteOpen((current) => !current)
      }
      if (event.key.toLowerCase() === 'n') {
        event.preventDefault()
        void createNote()
      }
      if (event.key.toLowerCase() === 'f' && event.shiftKey) {
        event.preventDefault()
        document.querySelector<HTMLInputElement>('[aria-label="Search notes"]')?.focus()
      }
      if (event.key === '1') setMode('edit')
      if (event.key === '2') setMode('split')
      if (event.key === '3') setMode('preview')
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [createNote])

  useEffect(() => {
    if (!hydrated.current || !selectedNote) return
    const signature = JSON.stringify(savePayload(selectedNote))
    if (savedSignatures.current.get(selectedNote.id) === signature) return

    setSaveState('saving')
    const existingTimer = saveTimers.current.get(selectedNote.id)
    if (existingTimer) window.clearTimeout(existingTimer)

    const timeout = window.setTimeout(async () => {
      try {
        const result = await window.folio.saveNote(savePayload(selectedNote))
        const saved = result.note
        const changedNotes = new Map(
          [saved, ...result.linkedNotes].map((note) => [note.id, note]),
        )
        for (const note of changedNotes.values()) {
          savedSignatures.current.set(note.id, JSON.stringify(savePayload(note)))
        }
        saveTimers.current.delete(saved.id)
        setLibrary((current) => ({
          ...current,
          notes: current.notes.map((note) => {
            const changed = changedNotes.get(note.id)
            if (!changed) return note
            if (note.id === saved.id && JSON.stringify(savePayload(note)) !== signature) return note
            return changed
          }),
          noteOrder: result.noteOrder,
        }))
        if (selectedIdRef.current === saved.id) setSaveState('saved')
      } catch (error) {
        console.error(error)
        setSaveState('error')
      }
    }, 450)
    saveTimers.current.set(selectedNote.id, timeout)
  }, [selectedNote])

  useEffect(() => {
    const timers = saveTimers.current
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [])

  const updateNote = (nextNote: Note) => {
    setLibrary((current) => ({
      ...current,
      notes: current.notes.map((note) => (note.id === nextNote.id ? nextNote : note)),
    }))
  }

  useEffect(
    () => window.folio.onPrepareVaultOperation(async () => {
      await persistSelectedNote()
    }),
    [persistSelectedNote],
  )

  const deleteNote = async (id: string) => {
    const targetNote = library.notes.find((note) => note.id === id)
    if (!targetNote) return
    const persistedSignature = savedSignatures.current.get(targetNote.id)
    let persistedTitle: string | undefined
    try {
      const persisted = persistedSignature ? JSON.parse(persistedSignature) as Partial<NoteUpdate> : undefined
      persistedTitle = typeof persisted?.title === 'string' ? persisted.title : undefined
    } catch {
      persistedTitle = undefined
    }
    const currentBacklinks = findBacklinks(library.notes, targetNote, library.notebooks)
    const persistedBacklinks = persistedTitle && persistedTitle !== targetNote.title
      ? findBacklinks(
          library.notes,
          { ...targetNote, title: persistedTitle },
          library.notebooks,
        )
      : []
    const linkedNotes = [...currentBacklinks, ...persistedBacklinks].filter(
      (note, index, notes) => notes.findIndex((item) => item.id === note.id) === index,
    )
    const linkedWarning = linkedNotes.length > 0
      ? `\n\n${linkedNotes.length} other note${linkedNotes.length === 1 ? '' : 's'} link to this note. Deleting it will leave ${linkedNotes.length === 1 ? 'that link' : 'those links'} unresolved.`
      : ''
    const shouldDelete = window.confirm(
      `Delete “${targetNote.title || 'Untitled note'}”?${linkedWarning}`,
    )
    if (!shouldDelete) return
    const pendingSave = saveTimers.current.get(targetNote.id)
    if (pendingSave) window.clearTimeout(pendingSave)
    saveTimers.current.delete(targetNote.id)
    savedSignatures.current.delete(targetNote.id)
    await window.folio.deleteNote(targetNote.id)
    const noteOrder = await window.folio.getNoteOrder()
    setLibrary((current) => ({
      ...current,
      notes: current.notes.filter((note) => note.id !== targetNote.id),
      noteOrder,
    }))
    if (selectedIdRef.current === targetNote.id) {
      const next = visibleNotes.find((note) => note.id !== targetNote.id)
      setSelectedId(next?.id)
    }
  }

  const toggleNotePinned = async (id: string) => {
    const persistedChanges = await persistSelectedNote()
    const note = persistedChanges.get(id) ?? library.notes.find((item) => item.id === id)
    if (!note) return
    const result = await window.folio.saveNote(savePayload({ ...note, pinned: !note.pinned }))
    const changedNotes = new Map(
      [result.note, ...result.linkedNotes].map((item) => [item.id, item]),
    )
    for (const changed of changedNotes.values()) {
      savedSignatures.current.set(changed.id, JSON.stringify(savePayload(changed)))
    }
    setLibrary((current) => ({
      ...current,
      notes: current.notes.map((item) => changedNotes.get(item.id) ?? item),
      noteOrder: result.noteOrder,
    }))
  }

  const reorderNotes = async (
    noteId: string,
    targetId: string,
    placement: 'before' | 'after',
  ) => {
    const noteOrder = await window.folio.reorderNotes({
      scope: selectedScope,
      noteId,
      targetId,
      placement,
    })
    setLibrary((current) => ({ ...current, noteOrder }))
  }

  return (
    <div className="app-shell">
      <LibrarySidebar
        notebooks={library.notebooks}
        noteCounts={noteCounts}
        selectedScope={selectedScope}
        onSelectScope={selectScope}
        onCreateNote={(notebookId) => void createNote(undefined, notebookId)}
        onCreateNotebook={createNotebook}
        onUpdateNotebook={updateNotebook}
        onDeleteNotebook={deleteNotebook}
        onMoveNotebook={moveNotebook}
        onMoveNote={moveNote}
        draggedItem={draggedLibraryItem}
        onDragNotebookStart={(id) => setDraggedLibraryItem({ kind: 'notebook', id })}
        onDragEnd={() => setDraggedLibraryItem(undefined)}
        vaultInfo={vaultInfo}
        onOpenVaultSettings={() => void window.folio.openSettings('vault')}
      />
      <NoteList
        notes={visibleNotes}
        selectedId={selectedId}
        query={query}
        searchMode={searchMode}
        searchStatus={searchStatus}
        sort={noteSort}
        snippets={searchSnippets}
        title={scopeTitle}
        onQueryChange={setQuery}
        onSearchModeChange={setSearchMode}
        onSortChange={setNoteSort}
        onSelect={setSelectedId}
        onCreate={() => void createNote()}
        onNoteDragStart={(id) => setDraggedLibraryItem({ kind: 'note', id })}
        onDragEnd={() => setDraggedLibraryItem(undefined)}
        reorderEnabled={noteSort === 'manual' && !query.trim()}
        onReorder={(noteId, targetId, placement) =>
          reorderNotes(noteId, targetId, placement)
        }
        onOpenContextMenu={(note) => {
          void window.folio.showLibraryItemContextMenu({
            kind: 'note',
            id: note.id,
            pinned: note.pinned,
          }).then((action) => {
            if (action === 'open') openNote(note.id)
            if (action === 'toggle-pin') void toggleNotePinned(note.id)
            if (action === 'delete') void deleteNote(note.id)
          })
        }}
      />
      <EditorWorkspace
        key={selectedNote?.id ?? 'empty'}
        note={selectedNote}
        notebooks={library.notebooks}
        mode={mode}
        saveState={saveState}
        wikiLinkCandidates={linkCandidates}
        backlinks={backlinks}
        lineWrapping={lineWrapping}
        onModeChange={setMode}
        onChange={updateNote}
        onDelete={() => selectedNote && void deleteNote(selectedNote.id)}
        onOpenNote={openNote}
        onOpenWikiLink={(title) => void openWikiLink(title)}
      />
      {paletteOpen && (
        <CommandPalette
          notes={library.notes}
          searchMode={searchMode}
          searchStatus={searchStatus}
          onClose={() => setPaletteOpen(false)}
          onCreateNote={() => void createNote()}
          onOpenNote={openNote}
          onSearchModeChange={setSearchMode}
          onSearchNotes={searchNotes}
          onSelectScope={selectScope}
          onModeChange={setMode}
        />
      )}
    </div>
  )
}
