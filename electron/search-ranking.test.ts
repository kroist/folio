import { describe, expect, it } from 'vitest'
import type { NoteSearchResult } from './types'
import { fuseSearchResults } from './search-ranking'

const result = (
  noteId: string,
  source: 'keyword' | 'semantic',
  snippet = `${source} snippet`,
): NoteSearchResult => ({ noteId, source, snippet, score: 1 })

describe('fuseSearchResults', () => {
  it('rewards notes found by both retrieval methods', () => {
    const fused = fuseSearchResults(
      [result('exact', 'keyword'), result('both', 'keyword')],
      [result('both', 'semantic'), result('related', 'semantic')],
      10,
    )

    expect(fused.map((item) => item.noteId)).toEqual(['both', 'exact', 'related'])
    expect(fused.every((item) => item.source === 'hybrid')).toBe(true)
  })

  it('honors the requested result limit', () => {
    expect(
      fuseSearchResults(
        [result('one', 'keyword'), result('two', 'keyword')],
        [result('three', 'semantic')],
        2,
      ),
    ).toHaveLength(2)
  })
})
