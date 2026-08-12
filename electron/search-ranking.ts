import type { NoteSearchResult } from './types'

export const fuseSearchResults = (
  keyword: NoteSearchResult[],
  semantic: NoteSearchResult[],
  limit: number,
): NoteSearchResult[] => {
  const scores = new Map<string, NoteSearchResult>()
  const add = (results: NoteSearchResult[]) => {
    results.forEach((result, index) => {
      const contribution = 1 / (61 + index)
      const current = scores.get(result.noteId)
      if (current) {
        current.score += contribution
        if (result.snippet && !current.snippet) current.snippet = result.snippet
      } else {
        scores.set(result.noteId, { ...result, score: contribution, source: 'hybrid' })
      }
    })
  }
  add(keyword)
  add(semantic)
  return [...scores.values()].sort((a, b) => b.score - a.score).slice(0, limit)
}
