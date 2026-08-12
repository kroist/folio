import { ChevronDown, ChevronRight, Cloud, HardDrive, Pencil, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { DragEvent } from 'react'
import { flattenNotebooks, notebookDescendantIds } from '../lib/notebooks'
import type { DraggedLibraryItem, LibraryScope, Notebook, VaultInfo } from '../types'
import { icons, Inbox, MoreHorizontal, Pin, Plus, Tags } from './Icon'
import { NotebookDialog } from './NotebookDialog'

interface LibrarySidebarProps {
  notebooks: Notebook[]
  noteCounts: Record<string, number>
  selectedScope: LibraryScope
  onSelectScope: (scope: LibraryScope) => void
  onCreateNote: (notebookId?: string) => void
  onCreateNotebook: (name: string, icon: string, parentId?: string) => Promise<void>
  onUpdateNotebook: (id: string, name: string, icon: string) => Promise<void>
  onDeleteNotebook: (id: string) => Promise<void>
  onMoveNotebook: (id: string, parentId?: string) => Promise<void>
  onMoveNote: (id: string, notebookId: string) => Promise<void>
  draggedItem?: DraggedLibraryItem
  onDragNotebookStart: (id: string) => void
  onDragEnd: () => void
  vaultInfo?: VaultInfo
  onOpenVaultSettings: () => void
}

interface NotebookDialogState {
  notebook?: Notebook
  parent?: Notebook
}

const COLLAPSED_NOTEBOOKS_KEY = 'folio.collapsed-notebooks'

const readCollapsedNotebooks = (): Set<string> => {
  try {
    const value = JSON.parse(window.localStorage.getItem(COLLAPSED_NOTEBOOKS_KEY) ?? '[]')
    return new Set(Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [])
  } catch {
    return new Set()
  }
}

export function LibrarySidebar({
  notebooks,
  noteCounts,
  selectedScope,
  onSelectScope,
  onCreateNote,
  onCreateNotebook,
  onUpdateNotebook,
  onDeleteNotebook,
  onMoveNotebook,
  onMoveNote,
  draggedItem,
  onDragNotebookStart,
  onDragEnd,
  vaultInfo,
  onOpenVaultSettings,
}: LibrarySidebarProps) {
  const [menuNotebookId, setMenuNotebookId] = useState<string>()
  const [dialog, setDialog] = useState<NotebookDialogState>()
  const [collapsedIds, setCollapsedIds] = useState(readCollapsedNotebooks)
  const [dragOverTarget, setDragOverTarget] = useState<string>()
  const [dropError, setDropError] = useState<string>()
  const tree = flattenNotebooks(notebooks, collapsedIds)

  useEffect(() => {
    window.localStorage.setItem(COLLAPSED_NOTEBOOKS_KEY, JSON.stringify([...collapsedIds]))
  }, [collapsedIds])

  const acceptsDrag = (root = false) =>
    draggedItem?.kind === 'notebook' || (!root && draggedItem?.kind === 'note')

  const dropOnNotebook = async (event: DragEvent, notebookId: string) => {
    event.preventDefault()
    setDragOverTarget(undefined)
    if (!draggedItem) return
    try {
      setDropError(undefined)
      if (draggedItem.kind === 'note') {
        await onMoveNote(draggedItem.id, notebookId)
        return
      }
      if (draggedItem.id === notebookId) return
      if (notebookDescendantIds(notebooks, draggedItem.id).has(notebookId)) return
      await onMoveNotebook(draggedItem.id, notebookId)
      setCollapsedIds((current) => {
        const next = new Set(current)
        next.delete(notebookId)
        return next
      })
    } catch (error) {
      setDropError(error instanceof Error ? error.message : 'Could not move item')
    } finally {
      onDragEnd()
    }
  }

  return (
    <aside className="library-pane">
      <div className="traffic-light-space" />
      <div className="library-heading">
        <span>Folio</span>
        <button className="icon-button" title="New note" onClick={() => onCreateNote()}>
          <Plus size={16} />
        </button>
      </div>

      <nav className="library-nav" aria-label="Library">
        <button
          className={selectedScope === 'all' ? 'nav-row active' : 'nav-row'}
          onClick={() => onSelectScope('all')}
        >
          <Inbox size={16} />
          <span>All notes</span>
          <small>{noteCounts.all ?? 0}</small>
        </button>
        <button
          className={selectedScope === 'pinned' ? 'nav-row active' : 'nav-row'}
          onClick={() => onSelectScope('pinned')}
        >
          <Pin size={16} />
          <span>Pinned</span>
          <small>{noteCounts.pinned ?? 0}</small>
        </button>
      </nav>

      <div
        className={`nav-section-heading${dragOverTarget === 'root' ? ' drag-over' : ''}`}
        onDragOver={(event) => {
          if (!acceptsDrag(true)) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          setDragOverTarget('root')
        }}
        onDragLeave={() => setDragOverTarget(undefined)}
        onDrop={(event) => {
          event.preventDefault()
          setDragOverTarget(undefined)
          if (draggedItem?.kind !== 'notebook') return
          void onMoveNotebook(draggedItem.id).catch((error: unknown) => {
            setDropError(error instanceof Error ? error.message : 'Could not move notebook')
          }).finally(onDragEnd)
        }}
      >
        <span>Notebooks</span>
        <button className="icon-button" title="New notebook" onClick={() => setDialog({})}>
          <Plus size={13} />
        </button>
      </div>
      <nav className="library-nav notebook-tree" aria-label="Notebooks">
        {tree.map(({ notebook, depth }) => {
          const NotebookIcon = icons[notebook.icon as keyof typeof icons] ?? icons.folder
          const menuOpen = menuNotebookId === notebook.id
          const hasChildren = notebooks.some((item) => item.parentId === notebook.id)
          const collapsed = collapsedIds.has(notebook.id)
          return (
            <div
              className={`notebook-row-wrap${dragOverTarget === notebook.id ? ' drag-over' : ''}`}
              key={notebook.id}
              onDragOver={(event) => {
                if (!acceptsDrag()) return
                if (
                  draggedItem?.kind === 'notebook' &&
                  notebookDescendantIds(notebooks, draggedItem.id).has(notebook.id)
                ) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                setDragOverTarget(notebook.id)
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setDragOverTarget(undefined)
                }
              }}
              onDrop={(event) => void dropOnNotebook(event, notebook.id)}
            >
              <button
                className={selectedScope === notebook.id ? 'nav-row active' : 'nav-row'}
                draggable
                style={{ paddingLeft: 25 + depth * 15 }}
                onClick={() => onSelectScope(notebook.id)}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', `folio:notebook:${notebook.id}`)
                  setDropError(undefined)
                  onDragNotebookStart(notebook.id)
                }}
                onDragEnd={() => {
                  setDragOverTarget(undefined)
                  onDragEnd()
                }}
                onContextMenu={(event) => {
                  event.preventDefault()
                  setMenuNotebookId(undefined)
                  onSelectScope(notebook.id)
                  void window.folio.showLibraryItemContextMenu({
                    kind: 'notebook',
                    id: notebook.id,
                  }).then((action) => {
                    if (action === 'new-note') onCreateNote(notebook.id)
                    if (action === 'new-subnotebook') setDialog({ parent: notebook })
                    if (action === 'rename') setDialog({ notebook })
                    if (action === 'delete') void onDeleteNotebook(notebook.id)
                  })
                }}
              >
                <NotebookIcon size={16} />
                <span>{notebook.name}</span>
                <small>{noteCounts[notebook.id] ?? 0}</small>
              </button>
              {hasChildren && (
                <button
                  className="notebook-expand-button"
                  style={{ left: 7 + depth * 15 }}
                  title={collapsed ? `Expand ${notebook.name}` : `Collapse ${notebook.name}`}
                  onClick={() => setCollapsedIds((current) => {
                    const next = new Set(current)
                    if (next.has(notebook.id)) next.delete(notebook.id)
                    else next.add(notebook.id)
                    return next
                  })}
                >
                  {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                </button>
              )}
              <button
                className="notebook-more-button"
                title={`More actions for ${notebook.name}`}
                onClick={() => setMenuNotebookId((current) =>
                  current === notebook.id ? undefined : notebook.id
                )}
              >
                <MoreHorizontal size={14} />
              </button>
              {menuOpen && (
                <>
                  <button
                    className="notebook-menu-dismiss"
                    aria-label="Close notebook menu"
                    onClick={() => setMenuNotebookId(undefined)}
                  />
                  <div className="notebook-menu">
                    <button onClick={() => {
                      setDialog({ parent: notebook })
                      setMenuNotebookId(undefined)
                    }}>
                      <Plus size={14} /> New sub-notebook
                    </button>
                    <button onClick={() => {
                      setDialog({ notebook })
                      setMenuNotebookId(undefined)
                    }}>
                      <Pencil size={14} /> Rename and icon
                    </button>
                    <button className="danger" onClick={() => {
                      setMenuNotebookId(undefined)
                      void onDeleteNotebook(notebook.id)
                    }}>
                      <Trash2 size={14} /> Delete notebook
                    </button>
                  </div>
                </>
              )}
            </div>
          )
        })}
        {dropError && <div className="notebook-drop-error">{dropError}</div>}
      </nav>

      <div className="library-footer">
        <div className="nav-row muted-row">
          <Tags size={16} />
          <span>Tags</span>
        </div>
        <button className="storage-button" onClick={onOpenVaultSettings}>
          {vaultInfo?.storage === 'icloud' ? <Cloud size={13} /> : <HardDrive size={13} />}
          <span>
            {vaultInfo?.storage === 'icloud' ? 'Synced with iCloud Drive' : 'Stored on this Mac'}
          </span>
        </button>
      </div>

      {dialog && (
        <NotebookDialog
          notebook={dialog.notebook}
          parentName={dialog.parent?.name}
          onClose={() => setDialog(undefined)}
          onSubmit={async (name, icon) => {
            if (dialog.notebook) {
              await onUpdateNotebook(dialog.notebook.id, name, icon)
            } else {
              await onCreateNotebook(name, icon, dialog.parent?.id)
              if (dialog.parent) {
                setCollapsedIds((current) => {
                  const next = new Set(current)
                  next.delete(dialog.parent!.id)
                  return next
                })
              }
            }
            setDialog(undefined)
          }}
        />
      )}
    </aside>
  )
}
