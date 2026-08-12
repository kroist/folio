import type { Note, Notebook } from './types'

export const normalizeWikiLinkTarget = (target: string): string =>
  target
    .split('/')
    .map((segment) => segment.trim().replace(/\s+/g, ' '))
    .join('/')
    .toLocaleLowerCase()

const safeVaultPathSegment = (value: string, fallback: string): string => {
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

export const legacyNoteWikiLinkTarget = (note: Note, notebooks: Notebook[]): string => {
  const byId = new Map(notebooks.map((notebook) => [notebook.id, notebook]))
  const segments: string[] = [note.title]
  const visited = new Set<string>()
  let notebook = byId.get(note.notebookId)
  while (notebook && !visited.has(notebook.id)) {
    visited.add(notebook.id)
    segments.unshift(notebook.name)
    notebook = notebook.parentId ? byId.get(notebook.parentId) : undefined
  }
  return segments.join('/')
}

export const noteWikiLinkTarget = (note: Note, notebooks: Notebook[]): string => {
  const byId = new Map(notebooks.map((notebook) => [notebook.id, notebook]))
  const title = safeVaultPathSegment(note.title, 'Untitled note')
  const stableId = safeVaultPathSegment(note.id.slice(0, 12), 'note')
  const segments: string[] = [`${title}--${stableId}.md`]
  const visited = new Set<string>()
  let notebook = byId.get(note.notebookId)
  while (notebook && !visited.has(notebook.id)) {
    visited.add(notebook.id)
    segments.unshift(safeVaultPathSegment(notebook.name, 'Notes'))
    notebook = notebook.parentId ? byId.get(notebook.parentId) : undefined
  }
  return segments.join('/')
}

export const rewriteWikiLinkTargets = (
  body: string,
  replacements: ReadonlyMap<string, string>,
): string => {
  if (replacements.size === 0) return body
  return body.replace(
    /\[\[([^\]|\n]+?)(\|[^\]\n]+?)?\]\]/g,
    (link, rawTarget: string, alias: string | undefined) => {
      const replacement = replacements.get(normalizeWikiLinkTarget(rawTarget))
      return replacement ? `[[${replacement}${alias ?? ''}]]` : link
    },
  )
}

export const renameWikiLinkTargets = (
  body: string,
  previousTitle: string,
  nextTitle: string,
): string => {
  const target = normalizeWikiLinkTarget(previousTitle)
  if (!target || target === normalizeWikiLinkTarget(nextTitle)) return body
  return rewriteWikiLinkTargets(body, new Map([[target, nextTitle]]))
}
