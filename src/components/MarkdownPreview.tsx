import ReactMarkdown, { type ExtraProps } from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { Link2 } from 'lucide-react'
import { useEffect, useMemo, useRef, type ComponentProps } from 'react'
import { toString } from 'hast-util-to-string'
import { remarkHighlights } from '../lib/remarkHighlights'
import { remarkWikiLinks } from '../lib/remarkWikiLinks'
import { createRehypeDocumentSearch } from '../lib/rehypeDocumentSearch'
import { replaceMarkdownRange } from '../lib/imageMarkdown'
import { PreviewImage } from './PreviewImage'
import { MermaidDiagram } from './MermaidDiagram'

function MarkdownCodeBlock({ node, children, ...props }: ComponentProps<'pre'> & ExtraProps) {
  const code = node?.children[0]
  if (code?.type === 'element' && Array.isArray(code.properties.className) && code.properties.className.includes('language-mermaid')) {
    const source = toString(code)
    return <MermaidDiagram key={source} source={source} />
  }
  return <pre {...props}>{children}</pre>
}

interface MarkdownPreviewProps {
  body: string
  noteId: string
  searchQuery?: string
  currentSearchMatch?: number
  onOpenWikiLink: (title: string) => void
  onChangeBody: (body: string) => void
}

export function MarkdownPreview({
  body,
  noteId,
  searchQuery = '',
  currentSearchMatch = -1,
  onOpenWikiLink,
  onChangeBody,
}: MarkdownPreviewProps) {
  const previewRef = useRef<HTMLElement>(null)
  const documentSearchPlugin = useMemo(
    () => createRehypeDocumentSearch(searchQuery, currentSearchMatch),
    [currentSearchMatch, searchQuery],
  )

  useEffect(() => {
    if (currentSearchMatch < 0) return
    previewRef.current
      ?.querySelector<HTMLElement>('.document-find-match-current')
      ?.scrollIntoView({ block: 'center', inline: 'nearest' })
  }, [currentSearchMatch, searchQuery])

  return (
    <article className="markdown-preview" ref={previewRef}>
      {body ? (
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath, remarkWikiLinks, remarkHighlights]}
          rehypePlugins={[[rehypeHighlight, { plainText: ['mermaid'] }], documentSearchPlugin, rehypeKatex]}
          components={{
            pre: MarkdownCodeBlock,
            a: ({ href, children, ...props }) => {
              if (href?.startsWith('#folio-note=')) {
                const title = decodeURIComponent(href.slice('#folio-note='.length))
                return (
                  <button className="wiki-link" onClick={() => onOpenWikiLink(title)}>
                    <Link2 size={12} />
                    {children}
                  </button>
                )
              }
              return <a href={href} {...props}>{children}</a>
            },
            img: ({ src, alt, title, node }) => (
              <PreviewImage
                key={src}
                noteId={noteId}
                source={src ?? ''}
                alt={alt}
                title={title}
                sourceStart={node?.position?.start.offset}
                sourceEnd={node?.position?.end.offset}
                onUpdate={(start, end, markdown) => {
                  const nextBody = replaceMarkdownRange(body, start, end, markdown)
                  if (nextBody !== body) onChangeBody(nextBody)
                }}
              />
            ),
          }}
        >
          {body}
        </ReactMarkdown>
      ) : (
        <p className="preview-placeholder">Nothing to preview yet.</p>
      )}
    </article>
  )
}
