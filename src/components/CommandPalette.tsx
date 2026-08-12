import {
  BookOpen,
  Eye,
  FilePlus2,
  FileText,
  LayoutPanelTop,
  LoaderCircle,
  PencilLine,
  Pin,
  Search,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { rankNotes } from '../lib/wikiLinks'
import type {
  EditorMode,
  Note,
  NoteSearchResult,
  SearchInput,
  SearchMode,
  SearchStatus,
} from '../types'

interface PaletteAction {
  id: string
  label: string
  detail: string
  icon: typeof FileText
  keywords: string
  run: () => void
}

interface CommandPaletteProps {
  notes: Note[]
  searchMode: SearchMode
  searchStatus: SearchStatus
  onClose: () => void
  onCreateNote: () => void
  onOpenNote: (id: string) => void
  onSearchModeChange: (mode: SearchMode) => void
  onSearchNotes: (input: SearchInput) => Promise<NoteSearchResult[]>
  onSelectScope: (scope: 'all' | 'pinned') => void
  onModeChange: (mode: EditorMode) => void
}

export function CommandPalette({
  notes,
  searchMode,
  searchStatus,
  onClose,
  onCreateNote,
  onOpenNote,
  onSearchModeChange,
  onSearchNotes,
  onSelectScope,
  onModeChange,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [searchResults, setSearchResults] = useState<NoteSearchResult[]>()
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(false)
  const searchRequestId = useRef(0)

  const actions = useMemo<PaletteAction[]>(
    () => [
      {
        id: 'new-note',
        label: 'Create a new note',
        detail: 'Command',
        icon: FilePlus2,
        keywords: 'new create note',
        run: onCreateNote,
      },
      {
        id: 'all-notes',
        label: 'Show all notes',
        detail: 'Navigation',
        icon: BookOpen,
        keywords: 'all notes library',
        run: () => onSelectScope('all'),
      },
      {
        id: 'pinned',
        label: 'Show pinned notes',
        detail: 'Navigation',
        icon: Pin,
        keywords: 'favorites pinned notes',
        run: () => onSelectScope('pinned'),
      },
      {
        id: 'edit-mode',
        label: 'Switch to edit mode',
        detail: '⌘1',
        icon: PencilLine,
        keywords: 'editor writing edit mode',
        run: () => onModeChange('edit'),
      },
      {
        id: 'split-mode',
        label: 'Switch to split mode',
        detail: '⌘2',
        icon: LayoutPanelTop,
        keywords: 'editor preview split mode',
        run: () => onModeChange('split'),
      },
      {
        id: 'preview-mode',
        label: 'Switch to preview mode',
        detail: '⌘3',
        icon: Eye,
        keywords: 'render reading preview mode',
        run: () => onModeChange('preview'),
      },
    ],
    [onCreateNote, onModeChange, onSelectScope],
  )

  const trimmedQuery = query.trim()
  const normalizedQuery = trimmedQuery.toLocaleLowerCase()
  useEffect(() => {
    const requestId = ++searchRequestId.current
    if (!trimmedQuery) return

    const timeout = window.setTimeout(async () => {
      try {
        const results = await onSearchNotes({
          query: trimmedQuery,
          mode: searchMode,
          limit: 16,
        })
        if (searchRequestId.current !== requestId) return
        setSearchResults(results)
      } catch (error) {
        if (searchRequestId.current !== requestId) return
        console.error(error)
        setSearchError(true)
      } finally {
        if (searchRequestId.current === requestId) setSearching(false)
      }
    }, 140)

    return () => window.clearTimeout(timeout)
  }, [onSearchNotes, searchMode, trimmedQuery])

  const visibleActions = actions.filter((action) =>
    `${action.label} ${action.keywords}`.toLocaleLowerCase().includes(normalizedQuery),
  )
  const localMatches = rankNotes(notes, query, 8)
  const notesById = new Map(notes.map((note) => [note.id, note]))
  const indexedMatches = searchResults
    ?.map((result) => notesById.get(result.noteId))
    .filter((note): note is Note => note !== undefined)
  const visibleNotes = indexedMatches
    ? [...indexedMatches, ...localMatches]
        .filter((note, index, matches) => matches.findIndex((item) => item.id === note.id) === index)
        .slice(0, 8)
    : localMatches
  const snippets = new Map(searchResults?.map((result) => [result.noteId, result.snippet]) ?? [])
  const items = [
    ...visibleActions.map((action) => ({ type: 'action' as const, action })),
    ...visibleNotes.map((note) => ({ type: 'note' as const, note })),
  ]

  const runItem = (index: number) => {
    const item = items[index]
    if (!item) return
    if (item.type === 'action') item.action.run()
    else onOpenNote(item.note.id)
    onClose()
  }

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <section
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <label className="palette-search">
          <Search size={18} />
          <input
            autoFocus
            value={query}
            placeholder="Search notes or type a command"
            onChange={(event) => {
              const nextQuery = event.target.value
              setQuery(nextQuery)
              setSelectedIndex(0)
              setSearchResults(undefined)
              setSearching(Boolean(nextQuery.trim()))
              setSearchError(false)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose()
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setSelectedIndex((current) => Math.min(current + 1, items.length - 1))
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setSelectedIndex((current) => Math.max(current - 1, 0))
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                runItem(selectedIndex)
              }
            }}
          />
          <kbd>esc</kbd>
        </label>

        <div className="palette-search-options">
          <div className="search-mode-switch" aria-label="Command palette search mode">
            {([
              ['keyword', 'Text'],
              ['semantic', 'Meaning'],
              ['hybrid', 'Hybrid'],
            ] as const).map(([value, label]) => (
              <button
                className={searchMode === value ? 'active' : ''}
                key={value}
                type="button"
                onClick={() => {
                  onSearchModeChange(value)
                  setSelectedIndex(0)
                  setSearchResults(undefined)
                  setSearching(Boolean(trimmedQuery))
                  setSearchError(false)
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {normalizedQuery && (searching || searchError) && (
            <span
              className={`palette-search-state${searchError ? ' error' : ''}`}
              title={searchError ? 'Search is unavailable' : searchStatus.message}
            >
              {searching && <LoaderCircle size={11} />}
              {searchError
                ? 'Index unavailable'
                : searchStatus.state === 'embedding' && searchStatus.progress !== undefined
                  ? `Embedding ${Math.round(searchStatus.progress * 100)}%`
                  : 'Searching index'}
            </span>
          )}
        </div>

        <div className="palette-results">
          {visibleActions.length > 0 && <div className="palette-group-label">Commands</div>}
          {visibleActions.map((action, index) => {
            const ActionIcon = action.icon
            return (
              <button
                className={selectedIndex === index ? 'palette-row selected' : 'palette-row'}
                key={action.id}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => runItem(index)}
              >
                <span className="palette-icon"><ActionIcon size={15} /></span>
                <span>{action.label}</span>
                <small>{action.detail}</small>
              </button>
            )
          })}

          {visibleNotes.length > 0 && <div className="palette-group-label">Notes</div>}
          {visibleNotes.map((note, noteIndex) => {
            const index = visibleActions.length + noteIndex
            return (
              <button
                className={selectedIndex === index ? 'palette-row selected' : 'palette-row'}
                key={note.id}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => runItem(index)}
              >
                <span className="palette-icon"><FileText size={15} /></span>
                <span className="palette-note-copy">
                  <strong>{note.title}</strong>
                  {snippets.get(note.id) && <small>{snippets.get(note.id)}</small>}
                </span>
                <small>{note.tags.slice(0, 2).map((tag) => `#${tag}`).join(' ')}</small>
              </button>
            )
          })}

          {items.length === 0 && (
            <div className="palette-empty">No matching notes or commands</div>
          )}
        </div>
        <footer className="palette-footer">
          <span><kbd>↑↓</kbd> Navigate</span>
          <span><kbd>↵</kbd> Open</span>
          <span><kbd>⌘K</kbd> Toggle</span>
        </footer>
      </section>
    </div>
  )
}
