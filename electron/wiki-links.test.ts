import { describe, expect, it } from 'vitest'
import { noteWikiLinkTarget, renameWikiLinkTargets, rewriteWikiLinkTargets } from './wiki-links'

describe('renameWikiLinkTargets', () => {
  it('renames matching targets while preserving aliases', () => {
    expect(
      renameWikiLinkTargets(
        'See [[Old title]], [[ old   TITLE |custom label]], and [[Another]].',
        'Old title',
        'New title',
      ),
    ).toBe('See [[New title]], [[New title|custom label]], and [[Another]].')
  })

  it('does not rewrite links for a casing-only title edit', () => {
    expect(renameWikiLinkTargets('[[Project]]', 'Project', 'PROJECT')).toBe('[[Project]]')
  })

  it('builds and rewrites path-qualified targets', () => {
    const notebooks = [
      { id: 'projects', name: 'Projects', icon: 'folder' },
      { id: 'folio', name: 'Folio', icon: 'code', parentId: 'projects' },
    ]
    const note = {
      id: 'note',
      notebookId: 'folio',
      title: 'Roadmap',
      body: '',
      tags: [],
      pinned: false,
      createdAt: '',
      updatedAt: '',
    }
    expect(noteWikiLinkTarget(note, notebooks)).toBe('Projects/Folio/Roadmap--note.md')
    expect(
      rewriteWikiLinkTargets(
        'See [[Projects/Folio/Roadmap|plan]].',
        new Map([['projects/folio/roadmap', 'Work/Folio/Roadmap--note.md']]),
      ),
    ).toBe('See [[Work/Folio/Roadmap--note.md|plan]].')
  })
})
