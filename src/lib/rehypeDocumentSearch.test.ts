import { describe, expect, it } from 'vitest'
import { createRehypeDocumentSearch } from './rehypeDocumentSearch'

describe('rendered Markdown document search', () => {
  it('wraps every rendered text match and marks the current one', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'p',
          children: [{ type: 'text', value: 'One match and MATCH.' }],
        },
      ],
    }

    createRehypeDocumentSearch('match', 1)()(tree)

    expect(tree.children[0].children).toEqual([
      { type: 'text', value: 'One ' },
      {
        type: 'element',
        tagName: 'mark',
        properties: {
          className: ['document-find-match'],
          'data-document-find-index': 0,
        },
        children: [{ type: 'text', value: 'match' }],
      },
      { type: 'text', value: ' and ' },
      {
        type: 'element',
        tagName: 'mark',
        properties: {
          className: ['document-find-match', 'document-find-match-current'],
          'data-document-find-index': 1,
        },
        children: [{ type: 'text', value: 'MATCH' }],
      },
      { type: 'text', value: '.' },
    ])
  })
})
