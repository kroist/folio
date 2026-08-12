import { describe, expect, it } from 'vitest'
import type { Notebook } from '../types'
import { flattenNotebooks, notebookDescendantIds, notebookPathLabel } from './notebooks'

const notebooks: Notebook[] = [
  { id: 'root', name: 'Projects', icon: 'folder' },
  { id: 'other', name: 'Personal', icon: 'home' },
  { id: 'child', name: 'Folio', icon: 'code', parentId: 'root' },
  { id: 'grandchild', name: 'Research', icon: 'book-open', parentId: 'child' },
]

describe('notebook hierarchy', () => {
  it('flattens notebooks in tree order with depths', () => {
    expect(flattenNotebooks(notebooks).map(({ notebook, depth }) => [notebook.id, depth])).toEqual([
      ['root', 0],
      ['child', 1],
      ['grandchild', 2],
      ['other', 0],
    ])
  })

  it('collects descendants and creates breadcrumb labels', () => {
    expect([...notebookDescendantIds(notebooks, 'root')]).toEqual(['root', 'child', 'grandchild'])
    expect(notebookPathLabel(notebooks, 'grandchild')).toBe('Projects / Folio / Research')
  })

  it('hides descendants of collapsed notebooks', () => {
    expect(flattenNotebooks(notebooks, new Set(['root'])).map(({ notebook }) => notebook.id)).toEqual([
      'root',
      'other',
    ])
  })
})
