import { describe, expect, it } from 'vitest'
import {
  attachmentImageMarkdown,
  parseImageLayout,
  replaceMarkdownRange,
} from './imageMarkdown'

describe('Folio image Markdown', () => {
  it('keeps a standard Markdown image while encoding Folio layout in its title', () => {
    expect(attachmentImageMarkdown('.attachments/note/photo.png', 'A lake')).toBe(
      '![A lake](.attachments/note/photo.png "width=100%;align=center")',
    )
  })

  it('parses supported layout values and defaults invalid metadata', () => {
    expect(parseImageLayout('width=50%;align=right')).toEqual({ width: '50%', align: 'right' })
    expect(parseImageLayout('width=900px;align=sideways')).toEqual({
      width: '100%',
      align: 'center',
    })
  })

  it('updates only the source range associated with a rendered image', () => {
    expect(replaceMarkdownRange('Before old after', 7, 10, 'new')).toBe('Before new after')
  })
})
