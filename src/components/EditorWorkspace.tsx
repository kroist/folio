import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { markdown } from '@codemirror/lang-markdown'
import { syntaxHighlighting } from '@codemirror/language'
import { Prec } from '@codemirror/state'
import { EditorView, keymap, type ViewUpdate } from '@codemirror/view'
import { classHighlighter } from '@lezer/highlight'
import CodeMirror from '@uiw/react-codemirror'
import { Bold, Code2, Highlighter, Italic, Link, Link2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import type { EditorMode, Note, Notebook } from '../types'
import {
  formatSelectionEdit,
  slashCommandEdit,
  slashCommands,
  type FormatKind,
} from '../lib/editorCommands'
import { flattenNotebooks } from '../lib/notebooks'
import { wordCount } from '../lib/notes'
import { attachmentImageMarkdown } from '../lib/imageMarkdown'
import { wikiCompletionEdit, type WikiLinkCandidate } from '../lib/wikiLinks'
import { PenLine, Pin, Trash2 } from './Icon'
import { MarkdownPreview } from './MarkdownPreview'

interface EditorWorkspaceProps {
  note?: Note
  notebooks: Notebook[]
  mode: EditorMode
  saveState: 'saved' | 'saving' | 'error'
  wikiLinkCandidates: WikiLinkCandidate[]
  backlinks: Note[]
  lineWrapping: boolean
  onModeChange: (mode: EditorMode) => void
  onChange: (note: Note) => void
  onDelete: () => void
  onOpenNote: (id: string) => void
  onOpenWikiLink: (title: string) => void
}

const wikiLinkCompletion = (candidates: WikiLinkCandidate[]) =>
  (context: CompletionContext): CompletionResult | null => {
    const match = context.matchBefore(/\[\[[^\]\n]*$/)
    if (!match) return null

    return {
      from: match.from + 2,
      options: candidates.map((candidate) => ({
        label: `${candidate.title} ${candidate.target}`,
        displayLabel: candidate.title,
        type: 'text',
        apply: (view, _completion, from, to) => {
          const followingText = view.state.sliceDoc(to, to + 2)
          const edit = wikiCompletionEdit(candidate.target, followingText)
          view.dispatch({
            changes: {
              from,
              to: to + edit.replaceFollowingCharacters,
              insert: edit.insert,
            },
            selection: { anchor: from + edit.insert.length },
          })
        },
        detail: candidate.notebookPath,
      })),
      validFor: /^[^\]\n]*$/,
    }
  }

const slashCompletion = (context: CompletionContext): CompletionResult | null => {
  const line = context.state.doc.lineAt(context.pos)
  const lineBeforeCursor = context.state.sliceDoc(line.from, context.pos)
  const match = /^(\s*)\/[\w-]*$/.exec(lineBeforeCursor)
  if (!match) return null

  const slashFrom = line.from + match[1].length
  return {
    from: slashFrom + 1,
    options: slashCommands.map((command) => ({
      label: `${command.label} ${command.keywords}`,
      displayLabel: command.label,
      detail: command.detail,
      type: `folio-${command.kind}`,
      apply: (view, _completion, _from, to) => {
        const edit = slashCommandEdit(command, slashFrom, to)
        view.dispatch({
          changes: edit.change,
          selection: edit.selection,
          userEvent: 'input.complete',
        })
      },
    })),
    validFor: /^[\w-]*$/,
  }
}

const applyFormat = (view: EditorView, kind: FormatKind): boolean => {
  const selection = view.state.selection.main
  if (selection.empty) return false
  const edit = formatSelectionEdit(view.state.doc.toString(), selection.from, selection.to, kind)
  view.dispatch({ changes: edit.change, selection: edit.selection, userEvent: 'input' })
  view.focus()
  return true
}

interface SelectionToolbarState {
  left: number
  top: number
}

export function EditorWorkspace({
  note,
  notebooks,
  mode,
  saveState,
  wikiLinkCandidates,
  backlinks,
  lineWrapping,
  onModeChange,
  onChange,
  onDelete,
  onOpenNote,
  onOpenWikiLink,
}: EditorWorkspaceProps) {
  const [tagDraft, setTagDraft] = useState('')
  const [selectionToolbar, setSelectionToolbar] = useState<SelectionToolbarState | null>(null)
  const [attachmentError, setAttachmentError] = useState<string>()
  const editorView = useRef<EditorView | null>(null)
  const notebookTree = useMemo(() => flattenNotebooks(notebooks), [notebooks])
  const editorExtensions = useMemo(
    () => [
      markdown(),
      syntaxHighlighting(classHighlighter),
      autocompletion({
        override: [wikiLinkCompletion(wikiLinkCandidates), slashCompletion],
        maxRenderedOptions: 12,
        tooltipClass: (state) => {
          const cursor = state.selection.main.head
          const line = state.doc.lineAt(cursor)
          return /^\s*\/[\w-]*$/.test(state.sliceDoc(line.from, cursor))
            ? 'folio-slash-tooltip'
            : 'folio-note-tooltip'
        },
        optionClass: (completion) =>
          completion.type?.startsWith('folio-') ? 'folio-slash-option' : 'folio-note-option',
      }),
      Prec.highest(
        keymap.of([
          { key: 'Mod-b', run: (view) => applyFormat(view, 'bold') },
          { key: 'Mod-i', run: (view) => applyFormat(view, 'italic') },
          { key: 'Mod-Shift-k', run: (view) => applyFormat(view, 'link') },
          { key: 'Mod-`', run: (view) => applyFormat(view, 'code') },
          { key: 'Mod-Shift-h', run: (view) => applyFormat(view, 'highlight') },
        ]),
      ),
      ...(lineWrapping ? [EditorView.lineWrapping] : []),
    ],
    [lineWrapping, wikiLinkCandidates],
  )

  const updateSelectionToolbar = (update: ViewUpdate) => {
    const selection = update.state.selection.main
    if (!update.view.hasFocus || selection.empty) {
      setSelectionToolbar((current) => (current === null ? current : null))
      return
    }

    const start = update.view.coordsAtPos(selection.from)
    const end = update.view.coordsAtPos(selection.to)
    if (!start || !end) return
    setSelectionToolbar({
      left: (start.left + end.right) / 2,
      top: Math.max(58, Math.min(start.top, end.top) - 8),
    })
  }

  const insertImageFiles = async (files: File[], position?: number) => {
    const view = editorView.current
    if (!view || files.length === 0) return
    setAttachmentError(undefined)
    if (position !== undefined) {
      view.dispatch({ selection: { anchor: position } })
    }

    try {
      for (const file of files) {
        const attachment = await window.folio.saveAttachment({
          noteId: note!.id,
          name: file.name || 'image',
          mimeType: file.type,
          data: new Uint8Array(await file.arrayBuffer()),
        })
        const cursor = view.state.selection.main.head
        const document = view.state.doc.toString()
        const prefix = cursor === 0
          ? ''
          : document.slice(Math.max(0, cursor - 2), cursor).endsWith('\n\n')
            ? ''
            : document[cursor - 1] === '\n' ? '\n' : '\n\n'
        const suffix = cursor === document.length
          ? ''
          : document.slice(cursor, cursor + 2).startsWith('\n\n')
            ? ''
            : document[cursor] === '\n' ? '\n' : '\n\n'
        const insert = `${prefix}${attachmentImageMarkdown(attachment.relativePath)}${suffix}`
        view.dispatch({
          changes: { from: cursor, insert },
          selection: { anchor: cursor + insert.length },
          scrollIntoView: true,
          userEvent: 'input',
        })
      }
      view.focus()
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : 'Could not attach image')
    }
  }

  if (!note) {
    return (
      <main className="workspace empty-workspace">
        <div className="empty-note-symbol"><PenLine size={28} /></div>
        <h2>Select a note to begin</h2>
        <p>Your writing space will appear here.</p>
      </main>
    )
  }

  const patchNote = (patch: Partial<Note>) => onChange({ ...note, ...patch })
  const addTag = () => {
    const tag = tagDraft.trim().replace(/^#/, '')
    if (tag && !note.tags.includes(tag)) patchNote({ tags: [...note.tags, tag] })
    setTagDraft('')
  }

  return (
    <main className="workspace">
      <header className="workspace-toolbar">
        <div className="mode-switch" aria-label="Editor mode">
          {(['edit', 'split', 'preview'] as EditorMode[]).map((item) => (
            <button
              className={mode === item ? 'active' : ''}
              key={item}
              onClick={() => onModeChange(item)}
            >
              {item[0].toUpperCase() + item.slice(1)}
            </button>
          ))}
        </div>
        <div className="toolbar-actions">
          <span className={`save-state ${saveState}`}>{saveState}</span>
          <button
            className={note.pinned ? 'icon-button pinned' : 'icon-button'}
            title={note.pinned ? 'Unpin note' : 'Pin note'}
            onClick={() => patchNote({ pinned: !note.pinned })}
          >
            <Pin size={16} fill={note.pinned ? 'currentColor' : 'none'} />
          </button>
          <button className="icon-button danger-hover" title="Delete note" onClick={onDelete}>
            <Trash2 size={16} />
          </button>
        </div>
      </header>

      <section className="document-header">
        <input
          className="title-input"
          aria-label="Note title"
          value={note.title}
          onChange={(event) => patchNote({ title: event.target.value })}
          placeholder="Untitled note"
        />
        <div className="metadata-row">
          <select
            aria-label="Notebook"
            value={note.notebookId}
            onChange={(event) => patchNote({ notebookId: event.target.value })}
          >
            {notebookTree.map(({ notebook, depth }) => (
              <option key={notebook.id} value={notebook.id}>
                {`${'\u00a0\u00a0'.repeat(depth)}${depth > 0 ? '↳ ' : ''}${notebook.name}`}
              </option>
            ))}
          </select>
          <span className="metadata-separator" />
          <div className="tag-editor">
            {note.tags.map((tag) => (
              <button
                key={tag}
                title={`Remove ${tag}`}
                onClick={() => patchNote({ tags: note.tags.filter((item) => item !== tag) })}
              >
                #{tag}
              </button>
            ))}
            <input
              aria-label="Add tag"
              value={tagDraft}
              onChange={(event) => setTagDraft(event.target.value)}
              onBlur={addTag}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ',') {
                  event.preventDefault()
                  addTag()
                }
              }}
              placeholder="Add tag"
            />
          </div>
        </div>
      </section>

      {selectionToolbar && mode !== 'preview' && (
        <div
          className="selection-toolbar"
          style={{ left: selectionToolbar.left, top: selectionToolbar.top }}
          role="toolbar"
          aria-label="Text formatting"
        >
          {([
            ['bold', Bold, 'Bold (⌘B)'],
            ['italic', Italic, 'Italic (⌘I)'],
            ['link', Link, 'Link (⌘⇧K)'],
            ['code', Code2, 'Inline code (⌘`)'],
            ['highlight', Highlighter, 'Highlight (⌘⇧H)'],
          ] as const).map(([kind, ToolbarIcon, label]) => (
            <button
              key={kind}
              title={label}
              aria-label={label}
              onMouseDown={(event) => {
                event.preventDefault()
                if (editorView.current) applyFormat(editorView.current, kind)
              }}
            >
              <ToolbarIcon size={14} />
            </button>
          ))}
        </div>
      )}

      <div className={`writing-area mode-${mode}`}>
        {mode !== 'preview' && (
          <div
            className="editor-surface"
            onPasteCapture={(event) => {
              const images = Array.from(event.clipboardData.files).filter((file) =>
                file.type.startsWith('image/'))
              if (images.length === 0) return
              event.preventDefault()
              event.stopPropagation()
              void insertImageFiles(images)
            }}
            onDragOver={(event) => {
              if (!event.dataTransfer.types.includes('Files')) return
              event.preventDefault()
              event.dataTransfer.dropEffect = 'copy'
            }}
            onDrop={(event) => {
              const images = Array.from(event.dataTransfer.files).filter((file) =>
                file.type.startsWith('image/'))
              if (images.length === 0) return
              event.preventDefault()
              event.stopPropagation()
              const view = editorView.current
              const position = view?.posAtCoords({ x: event.clientX, y: event.clientY }) ?? undefined
              void insertImageFiles(images, position)
            }}
            onMouseDown={(event) => {
              const view = editorView.current
              if (!view) return
              if (event.detail >= 4) {
                event.preventDefault()
                view.dispatch({
                  selection: { anchor: 0, head: view.state.doc.length },
                  scrollIntoView: true,
                })
                view.focus()
                return
              }

              const target = event.target as HTMLElement
              if (target.closest('.cm-line') || target.closest('.cm-tooltip')) return

              event.preventDefault()
              const documentEnd = view.state.doc.length
              view.dispatch({
                selection: { anchor: documentEnd },
                scrollIntoView: true,
              })
              view.focus()
            }}
          >
            <CodeMirror
              className="folio-editor"
              value={note.body}
              height="100%"
              extensions={editorExtensions}
              onCreateEditor={(view) => {
                editorView.current = view
              }}
              onUpdate={updateSelectionToolbar}
              onChange={(body) => patchNote({ body })}
              basicSetup={{
                lineNumbers: false,
                foldGutter: false,
                highlightActiveLine: false,
                highlightActiveLineGutter: false,
                highlightSelectionMatches: false,
                bracketMatching: true,
                closeBrackets: true,
                autocompletion: false,
                syntaxHighlighting: false,
              }}
            />
          </div>
        )}
        {mode !== 'edit' && (
          <div className="preview-surface">
            <MarkdownPreview
              body={note.body}
              noteId={note.id}
              onOpenWikiLink={onOpenWikiLink}
              onChangeBody={(body) => patchNote({ body })}
            />
          </div>
        )}
      </div>
      {attachmentError && (
        <div className="attachment-error" role="alert">
          {attachmentError}
          <button onClick={() => setAttachmentError(undefined)}>Dismiss</button>
        </div>
      )}
      <section className="linked-mentions-bar" aria-label="Linked mentions">
        <div className="linked-mentions-label">
          <Link2 size={13} />
          <span>Linked mentions</span>
          <small>{backlinks.length}</small>
        </div>
        <div className="linked-mentions-list">
          {backlinks.length > 0 ? (
            backlinks.map((backlink) => (
              <button key={backlink.id} onClick={() => onOpenNote(backlink.id)}>
                {backlink.title}
              </button>
            ))
          ) : (
            <span>No notes link here</span>
          )}
        </div>
      </section>
      <footer className="document-footer">
        <span>{wordCount(note.body)} words</span>
        <span>Markdown</span>
      </footer>
    </main>
  )
}
