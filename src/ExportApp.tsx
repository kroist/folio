import { useEffect, useState } from 'react'
import { MarkdownPreview } from './components/MarkdownPreview'
import type { Note } from './types'

export function ExportDocument({ note }: { note: Note }) {
  const bodyTitle = /^\s*#\s+(.+?)\s*(?:\r?\n|$)/.exec(note.body)?.[1]
  return (
    <main className="export-document" data-export-ready>
      {bodyTitle !== note.title.trim() && (
        <h1 className="export-title">{note.title || 'Untitled note'}</h1>
      )}
      <MarkdownPreview
        body={note.body}
        noteId={note.id}
        onOpenWikiLink={() => undefined}
        onChangeBody={() => undefined}
      />
    </main>
  )
}

export function ExportApp() {
  const noteId = new URLSearchParams(window.location.search).get('noteId')
  const [note, setNote] = useState<Note>()

  useEffect(() => {
    void window.folio.listLibrary().then((library) => {
      setNote(library.notes.find((candidate) => candidate.id === noteId))
    })
  }, [noteId])

  if (!note) return null
  return <ExportDocument note={note} />
}
