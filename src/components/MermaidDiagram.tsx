import { useEffect, useState } from 'react'

let renderer: Promise<typeof import('mermaid')['default']> | undefined

const loadRenderer = () => renderer ??= import('mermaid').then(({ default: mermaid }) => {
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral', suppressErrorRendering: true })
  return mermaid
})

export function MermaidDiagram({ source }: { source: string }) {
  const [result, setResult] = useState<{ svg?: string; error?: string }>({})

  useEffect(() => {
    let active = true
    void loadRenderer()
      .then((mermaid) => mermaid.render(`folio-mermaid-${crypto.randomUUID()}`, source))
      .then(({ svg }) => { if (active) setResult({ svg }) })
      .catch((error: unknown) => {
        if (active) setResult({ error: error instanceof Error ? error.message : 'Invalid Mermaid diagram' })
      })
    return () => { active = false }
  }, [source])

  return (
    <figure className="mermaid-diagram" data-diagram-loading={!result.svg && !result.error ? true : undefined}>
      {result.svg ? (
        <img alt="Mermaid diagram" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.svg)}`} />
      ) : (
        <>
          <figcaption role="status">{result.error ? `Could not render diagram: ${result.error}` : 'Rendering diagram…'}</figcaption>
          <pre><code>{source}</code></pre>
        </>
      )}
    </figure>
  )
}
