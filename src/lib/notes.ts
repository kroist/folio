import type { LibraryScope, Note, NoteSort } from '../types'

export const filterAndSortNotes = (
  notes: Note[],
  scope: LibraryScope,
  query: string,
  sort: NoteSort = 'updated',
  manualOrder: string[] = [],
): Note[] => {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const manualPositions = new Map(manualOrder.map((id, index) => [id, index]))

  return notes
    .filter((note) => {
      if (scope === 'pinned' && !note.pinned) return false
      if (scope !== 'all' && scope !== 'pinned' && note.notebookId !== scope) return false
      if (!normalizedQuery) return true
      const searchable = `${note.title}\n${note.body}\n${note.tags.join(' ')}`.toLocaleLowerCase()
      return searchable.includes(normalizedQuery)
    })
    .sort((left, right) => {
      if (sort === 'title') {
        return left.title.localeCompare(right.title, undefined, { numeric: true, sensitivity: 'base' })
      }
      if (sort === 'created') return Date.parse(right.createdAt) - Date.parse(left.createdAt)
      if (sort === 'manual') {
        const leftPosition = manualPositions.get(left.id) ?? Number.MAX_SAFE_INTEGER
        const rightPosition = manualPositions.get(right.id) ?? Number.MAX_SAFE_INTEGER
        if (leftPosition !== rightPosition) return leftPosition - rightPosition
      }
      return Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
    })
}

export const noteExcerpt = (body: string, maxLength = 128): string => {
  const plain = body
    .replace(/```[\s\S]*?```/g, ' code ')
    .replace(/[#>*_`~\-[\]()!]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return plain.length > maxLength ? `${plain.slice(0, maxLength).trim()}…` : plain
}

export const wordCount = (body: string): number => {
  const words = body.trim().match(/\S+/g)
  return words?.length ?? 0
}

export const relativeDate = (isoDate: string, now = new Date()): string => {
  const date = new Date(isoDate)
  const dayDifference = Math.floor(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
      new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) /
      86_400_000,
  )

  if (dayDifference <= 0) {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date)
  }
  if (dayDifference === 1) return 'Yesterday'
  if (dayDifference < 7) {
    return new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date)
  }
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date)
}
