import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MarkdownPreview } from './MarkdownPreview'
import { ExportDocument } from '../ExportApp'

describe('MarkdownPreview math', () => {
  it('renders inline and block LaTeX with KaTeX', () => {
    const html = renderToStaticMarkup(
      <MarkdownPreview
        body={'Inline $E = mc^2$.\n\n$$\n\\int_0^1 x^2 dx\n$$'}
        noteId="test"
        onOpenWikiLink={() => undefined}
        onChangeBody={() => undefined}
      />,
    )

    expect(html).toContain('katex')
    expect(html).toContain('katex-display')
    expect(html).toContain('E = mc^2')
  })

  it('does not repeat a note title already present as its first heading', () => {
    const html = renderToStaticMarkup(<ExportDocument note={{
      id: 'test',
      title: 'Same title',
      body: '# Same title\n\nBody',
      notebookId: 'test',
      tags: [],
      pinned: false,
      createdAt: '',
      updatedAt: '',
    }} />)
    expect(html).not.toContain('export-title')
  })
})
