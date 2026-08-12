import { describe, expect, it } from 'vitest'
import type { Note } from '../types'
import { filterAndSortNotes, noteExcerpt, relativeDate, wordCount } from './notes'

const makeNote = (overrides: Partial<Note>): Note => ({
  id: 'note-1',
  notebookId: 'personal',
  title: 'Alpha',
  body: 'Some text',
  tags: [],
  pinned: false,
  createdAt: '2026-08-10T10:00:00.000Z',
  updatedAt: '2026-08-10T10:00:00.000Z',
  ...overrides,
})

describe('filterAndSortNotes', () => {
  it('filters across title, body, and tags', () => {
    const notes = [
      makeNote({ id: '1', title: 'Trip notes' }),
      makeNote({ id: '2', body: 'A quiet garden' }),
      makeNote({ id: '3', tags: ['travel'] }),
    ]

    expect(filterAndSortNotes(notes, 'all', 'trip').map((note) => note.id)).toEqual(['1'])
    expect(filterAndSortNotes(notes, 'all', 'travel').map((note) => note.id)).toEqual(['3'])
  })

  it('sorts by the selected derived order without pinning overriding it', () => {
    const notes = [
      makeNote({ id: 'new', updatedAt: '2026-08-11T10:00:00.000Z' }),
      makeNote({ id: 'pin', pinned: true, updatedAt: '2026-08-09T10:00:00.000Z' }),
    ]

    expect(filterAndSortNotes(notes, 'all', '', 'updated').map((note) => note.id)).toEqual([
      'new',
      'pin',
    ])
    expect(filterAndSortNotes(notes, 'pinned', '', 'updated').map((note) => note.id)).toEqual([
      'pin',
    ])
  })

  it('uses the order for the current manual scope', () => {
    const notes = [makeNote({ id: 'a' }), makeNote({ id: 'b' }), makeNote({ id: 'c' })]

    expect(filterAndSortNotes(notes, 'all', '', 'manual', ['c', 'a', 'b']).map((note) => note.id))
      .toEqual(['c', 'a', 'b'])
  })
})

describe('note presentation helpers', () => {
  it('creates a clean Markdown excerpt', () => {
    expect(noteExcerpt('# Heading\n\nThis is **important**.')).toBe('Heading This is important .')
  })

  it('counts non-whitespace groups as words', () => {
    expect(wordCount('one  two\nthree')).toBe(3)
    expect(wordCount('')).toBe(0)
  })

  it('uses friendly relative dates', () => {
    const now = new Date('2026-08-11T18:00:00.000Z')
    expect(relativeDate('2026-08-10T10:00:00.000Z', now)).toBe('Yesterday')
  })
})
