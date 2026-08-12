import { describe, expect, it } from 'vitest'
import type { Note } from '../types'
import {
  extractWikiLinks,
  findBacklinks,
  findNoteByTitle,
  findNoteByWikiLink,
  noteWikiLinkTarget,
  normalizeNoteTitle,
  rankNotes,
  wikiLinkCandidates,
  wikiCompletionEdit,
} from './wikiLinks'

const note = (id: string, title: string, body = '', updatedAt = '2026-08-11T10:00:00Z'): Note => ({
  id,
  notebookId: 'personal',
  title,
  body,
  tags: [],
  pinned: false,
  createdAt: updatedAt,
  updatedAt,
})

describe('wiki links', () => {
  it('reuses closing brackets that already follow the completion', () => {
    expect(wikiCompletionEdit('Project Atlas', ']] next')).toEqual({
      insert: 'Project Atlas]]',
      replaceFollowingCharacters: 2,
    })
    expect(wikiCompletionEdit('Project Atlas', '] next').replaceFollowingCharacters).toBe(1)
    expect(wikiCompletionEdit('Project Atlas', ' next').replaceFollowingCharacters).toBe(0)
  })

  it('extracts targets and optional labels', () => {
    expect(extractWikiLinks('See [[Project Atlas]] and [[Daily notes|journal]].')).toEqual([
      { target: 'Project Atlas', label: 'Project Atlas' },
      { target: 'Daily notes', label: 'journal' },
    ])
  })

  it('matches titles without case or whitespace sensitivity', () => {
    const notes = [note('1', 'Project Atlas')]
    expect(normalizeNoteTitle('  PROJECT   atlas ')).toBe('project atlas')
    expect(findNoteByTitle(notes, 'project atlas')?.id).toBe('1')
  })

  it('finds backlinks in newest-first order', () => {
    const target = note('target', 'Project Atlas')
    const notes = [
      target,
      note('old', 'Old', 'See [[Project Atlas]]', '2026-08-09T10:00:00Z'),
      note('new', 'New', 'See [[project atlas|the project]]', '2026-08-10T10:00:00Z'),
      note('other', 'Other', 'See [[Somewhere else]]'),
    ]
    expect(findBacklinks(notes, target).map((item) => item.id)).toEqual(['new', 'old'])
  })

  it('uses notebook paths to disambiguate duplicate titles', () => {
    const notebooks = [
      { id: 'personal', name: 'Personal', icon: 'home' },
      { id: 'projects', name: 'Projects', icon: 'folder' },
    ]
    const personal = note('personal-roadmap', 'Roadmap')
    const project = { ...note('project-roadmap', 'Roadmap'), notebookId: 'projects' }
    const source = note('source', 'Source', 'See [[Projects/Roadmap]].')
    const notes = [personal, project, source]

    expect(noteWikiLinkTarget(project, notebooks)).toBe(
      'Projects/Roadmap--project-road.md',
    )
    expect(findNoteByWikiLink(
      notes,
      notebooks,
      'Projects/Roadmap--project-road.md',
    )?.id).toBe('project-roadmap')
    expect(findNoteByWikiLink(notes, notebooks, 'Projects/Roadmap')?.id).toBe('project-roadmap')
    expect(findBacklinks(notes, project, notebooks).map((item) => item.id)).toEqual(['source'])
    expect(wikiLinkCandidates(notes, notebooks)[1]).toMatchObject({
      title: 'Roadmap',
      target: 'Projects/Roadmap--project-road.md',
      notebookPath: 'Projects',
    })
  })
})

describe('rankNotes', () => {
  it('prioritizes direct title matches and supports subsequences', () => {
    const notes = [note('daily', 'Daily notes'), note('design', 'Design log'), note('roadmap', 'Roadmap')]
    expect(rankNotes(notes, 'daily')[0].id).toBe('daily')
    expect(rankNotes(notes, 'dsn')[0].id).toBe('design')
  })
})
