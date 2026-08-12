import { notebookPathLabel } from './notebooks'
import type { Note, Notebook } from '../types'

export interface WikiLink {
  target: string
  label: string
}

export interface WikiLinkCandidate {
  noteId: string
  title: string
  target: string
  notebookPath: string
}

export const wikiCompletionEdit = (
  title: string,
  followingText: string,
): { insert: string; replaceFollowingCharacters: number } => ({
  insert: `${title}]]`,
  replaceFollowingCharacters: followingText.startsWith(']]')
    ? 2
    : followingText.startsWith(']')
      ? 1
      : 0,
})

export const normalizeNoteTitle = (title: string): string =>
  title
    .split('/')
    .map((segment) => segment.trim().replace(/\s+/g, ' '))
    .join('/')
    .toLocaleLowerCase()

export const safeVaultPathSegment = (value: string, fallback: string): string => {
  const printableValue = [...value.normalize('NFC')]
    .map((character) => (character.charCodeAt(0) < 32 ? '-' : character))
    .join('')
  const sanitized = printableValue
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 120)
  return sanitized || fallback
}

const legacyNoteWikiLinkTarget = (note: Note, notebooks: Notebook[]): string => {
  const notebookPath = notebookPathLabel(notebooks, note.notebookId).replaceAll(' / ', '/')
  return notebookPath ? `${notebookPath}/${note.title}` : note.title
}

export const noteWikiLinkTarget = (note: Note, notebooks: Notebook[]): string => {
  const notebookPath = notebookPathLabel(notebooks, note.notebookId)
    .split(' / ')
    .filter(Boolean)
    .map((segment) => safeVaultPathSegment(segment, 'Notes'))
    .join('/')
  const title = safeVaultPathSegment(note.title, 'Untitled note')
  const stableId = safeVaultPathSegment(note.id.slice(0, 12), 'note')
  const fileName = `${title}--${stableId}.md`
  return notebookPath ? `${notebookPath}/${fileName}` : fileName
}

export const wikiLinkCandidates = (
  notes: Note[],
  notebooks: Notebook[],
): WikiLinkCandidate[] =>
  notes.map((note) => ({
    noteId: note.id,
    title: note.title,
    target: noteWikiLinkTarget(note, notebooks),
    notebookPath: notebookPathLabel(notebooks, note.notebookId),
  }))

export const extractWikiLinks = (body: string): WikiLink[] => {
  const links: WikiLink[] = []
  const pattern = /\[\[([^\]|\n]+?)(?:\|([^\]\n]+?))?\]\]/g
  let match: RegExpExecArray | null

  while ((match = pattern.exec(body))) {
    const target = match[1].trim()
    const label = (match[2] ?? target).trim()
    if (target) links.push({ target, label })
  }

  return links
}

export const findNoteByTitle = (notes: Note[], title: string): Note | undefined => {
  const normalized = normalizeNoteTitle(title)
  return notes.find((note) => normalizeNoteTitle(note.title) === normalized)
}

export const findNoteByWikiLink = (
  notes: Note[],
  notebooks: Notebook[],
  target: string,
  sourceNotebookId?: string,
): Note | undefined => {
  const normalized = normalizeNoteTitle(target)
  const pathMatch = notes.find(
    (note) => normalizeNoteTitle(noteWikiLinkTarget(note, notebooks)) === normalized,
  )
  if (pathMatch) return pathMatch

  const legacyPathMatch = notes.find(
    (note) => normalizeNoteTitle(legacyNoteWikiLinkTarget(note, notebooks)) === normalized,
  )
  if (legacyPathMatch) return legacyPathMatch

  const titleMatches = notes.filter((note) => normalizeNoteTitle(note.title) === normalized)
  if (titleMatches.length === 1) return titleMatches[0]
  return titleMatches.find((note) => note.notebookId === sourceNotebookId) ?? titleMatches[0]
}

export const findBacklinks = (
  notes: Note[],
  activeNote: Note,
  notebooks: Notebook[] = [],
): Note[] => {
  if (!normalizeNoteTitle(activeNote.title)) return []

  return notes
    .filter(
      (note) =>
        note.id !== activeNote.id &&
        extractWikiLinks(note.body).some(
          (link) =>
            findNoteByWikiLink(notes, notebooks, link.target, note.notebookId)?.id === activeNote.id,
        ),
    )
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
}

const fuzzyScore = (value: string, query: string): number | null => {
  const candidate = value.toLocaleLowerCase()
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return 0

  const directIndex = candidate.indexOf(needle)
  if (directIndex >= 0) return 1_000 - directIndex * 4 - candidate.length

  let score = 0
  let candidateIndex = 0
  let previousMatch = -2

  for (const character of needle) {
    const matchIndex = candidate.indexOf(character, candidateIndex)
    if (matchIndex < 0) return null
    const isBoundary = matchIndex === 0 || /[\s\-_/]/.test(candidate[matchIndex - 1])
    if (isBoundary) score += 12
    if (matchIndex === previousMatch + 1) score += 8
    score -= matchIndex - candidateIndex
    previousMatch = matchIndex
    candidateIndex = matchIndex + 1
  }

  return score - candidate.length * 0.05
}

export const rankNotes = (notes: Note[], query: string, limit = 10): Note[] =>
  notes
    .map((note) => ({ note, score: fuzzyScore(`${note.title} ${note.tags.join(' ')}`, query) }))
    .filter((item): item is { note: Note; score: number } => item.score !== null)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((item) => item.note)
