import { useState } from 'react'
import { ArrowDownUp, LoaderCircle } from 'lucide-react'
import type { Note, NoteSort } from '../types'
import type { SearchMode, SearchStatus } from '../types'
import { noteExcerpt, relativeDate } from '../lib/notes'
import { FileText, Pin, Plus, Search } from './Icon'

interface NoteListProps {
  notes: Note[]
  selectedId?: string
  query: string
  searchMode: SearchMode
  searchStatus: SearchStatus
  sort: NoteSort
  snippets: Map<string, string>
  title: string
  onQueryChange: (query: string) => void
  onSearchModeChange: (mode: SearchMode) => void
  onSortChange: (sort: NoteSort) => void
  onSelect: (id: string) => void
  onCreate: () => void
  onNoteDragStart: (id: string) => void
  onDragEnd: () => void
  reorderEnabled: boolean
  onReorder: (
    noteId: string,
    targetId: string,
    placement: 'before' | 'after',
  ) => Promise<void>
  onOpenContextMenu: (note: Note) => void
}

export function NoteList({
  notes,
  selectedId,
  query,
  searchMode,
  searchStatus,
  sort,
  snippets,
  title,
  onQueryChange,
  onSearchModeChange,
  onSortChange,
  onSelect,
  onCreate,
  onNoteDragStart,
  onDragEnd,
  reorderEnabled,
  onReorder,
  onOpenContextMenu,
}: NoteListProps) {
  const [draggedId, setDraggedId] = useState<string>()
  const [dropTarget, setDropTarget] = useState<{
    id: string
    placement: 'before' | 'after'
  }>()

  const finishDrag = () => {
    setDraggedId(undefined)
    setDropTarget(undefined)
    onDragEnd()
  }

  return (
    <section className="notes-pane">
      <header className="notes-header">
        <div>
          <h1>{title}</h1>
          <span>{notes.length} {notes.length === 1 ? 'note' : 'notes'}</span>
        </div>
        <button className="round-button" title="New note" onClick={onCreate}>
          <Plus size={17} />
        </button>
      </header>
      <label className="search-box">
        <Search size={15} />
        <input
          aria-label="Search notes"
          placeholder="Search notes"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
        <kbd>⌘⇧F</kbd>
      </label>
      <div className="search-mode-row">
        <div className="search-mode-switch" aria-label="Search mode">
          {([
            ['keyword', 'Text'],
            ['semantic', 'Meaning'],
            ['hybrid', 'Hybrid'],
          ] as const).map(([mode, label]) => (
            <button
              className={searchMode === mode ? 'active' : ''}
              key={mode}
              title={mode === 'semantic' ? 'Local semantic search' : `${label} search`}
              onClick={() => onSearchModeChange(mode)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="note-list-controls">
          {query && searchStatus.state !== 'ready' && searchStatus.state !== 'idle' && (
            <span className={`search-progress ${searchStatus.state}`} title={searchStatus.message}>
              {(searchStatus.state === 'indexing' ||
                searchStatus.state === 'embedding' ||
                searchStatus.state === 'searching') && <LoaderCircle size={11} />}
              {searchStatus.state === 'embedding' && searchStatus.progress !== undefined
                ? `${Math.round(searchStatus.progress * 100)}%`
                : searchStatus.state === 'error'
                  ? 'Unavailable'
                  : 'Working'}
            </span>
          )}
          {!query.trim() && (
            <label className="note-sort-control" title="Sort notes">
              <ArrowDownUp size={11} />
              <select
                aria-label="Sort notes"
                value={sort}
                onChange={(event) => onSortChange(event.target.value as NoteSort)}
              >
                <option value="manual">Manual</option>
                <option value="updated">Last edited</option>
                <option value="created">Created</option>
                <option value="title">Title</option>
              </select>
            </label>
          )}
        </div>
      </div>
      <div className="note-list">
        {notes.map((note) => (
          <button
            className={[
              'note-card',
              note.id === selectedId ? 'selected' : '',
              dropTarget?.id === note.id ? `drop-${dropTarget.placement}` : '',
            ].filter(Boolean).join(' ')}
            draggable
            key={note.id}
            title={reorderEnabled ? 'Drag to reorder or move to a notebook' : 'Drag to move to a notebook'}
            onClick={() => onSelect(note.id)}
            onContextMenu={(event) => {
              event.preventDefault()
              onSelect(note.id)
              onOpenContextMenu(note)
            }}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData('text/plain', `folio:note:${note.id}`)
              setDraggedId(note.id)
              onNoteDragStart(note.id)
            }}
            onDragOver={(event) => {
              if (!reorderEnabled || !draggedId || draggedId === note.id) return
              event.preventDefault()
              event.stopPropagation()
              event.dataTransfer.dropEffect = 'move'
              const bounds = event.currentTarget.getBoundingClientRect()
              setDropTarget({
                id: note.id,
                placement: event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after',
              })
            }}
            onDragLeave={(event) => {
              if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
              setDropTarget((current) => current?.id === note.id ? undefined : current)
            }}
            onDrop={(event) => {
              if (!reorderEnabled || !draggedId || draggedId === note.id) return
              event.preventDefault()
              event.stopPropagation()
              const sourceId = draggedId
              const bounds = event.currentTarget.getBoundingClientRect()
              const placement = event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'
              finishDrag()
              void onReorder(sourceId, note.id, placement).catch((error: unknown) => {
                console.error('Could not reorder notes', error)
              })
            }}
            onDragEnd={finishDrag}
          >
            <div className="note-card-heading">
              <strong>{note.title || 'Untitled note'}</strong>
              {note.pinned && <Pin size={12} fill="currentColor" />}
            </div>
            <p>{snippets.get(note.id) || noteExcerpt(note.body) || 'Empty note'}</p>
            <div className="note-card-footer">
              <span>{relativeDate(note.updatedAt)}</span>
              <div className="mini-tags">
                {note.tags.slice(0, 2).map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
            </div>
          </button>
        ))}
        {notes.length === 0 && (
          <div className="empty-list">
            <FileText size={26} />
            <strong>No notes found</strong>
            <span>Try another search or create a fresh note.</span>
          </div>
        )}
      </div>
    </section>
  )
}
