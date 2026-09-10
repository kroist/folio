import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MarkdownPreview } from './MarkdownPreview'
import { ExportDocument } from '../ExportApp'

describe('MarkdownPreview math', () => {
  it('renders Mermaid fences as diagrams while preserving ordinary code blocks', () => {
    const html = renderToStaticMarkup(<MarkdownPreview
      body={'```mermaid\ngraph TD\n  A --> B\n```\n\n```js\nconst x = 1\n```'}
      noteId="test"
      searchQuery="A"
      onOpenWikiLink={() => undefined}
      onChangeBody={() => undefined}
    />)
    expect(html).toContain('data-diagram-loading="true"')
    expect(html).toContain('graph TD\n  A --&gt; B')
    expect(html).toContain('language-js')
    expect(html.match(/class="mermaid-diagram"/g)).toHaveLength(1)
  })

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
