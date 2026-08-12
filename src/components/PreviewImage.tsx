import { AlignCenter, AlignLeft, AlignRight, Image as ImageIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import {
  attachmentImageMarkdown,
  parseImageLayout,
  type ImageAlignment,
  type ImageWidth,
} from '../lib/imageMarkdown'

interface PreviewImageProps {
  noteId: string
  source: string
  alt?: string
  title?: string
  sourceStart?: number
  sourceEnd?: number
  onUpdate: (start: number | undefined, end: number | undefined, markdown: string) => void
}

const widths: ImageWidth[] = ['auto', '25%', '50%', '75%', '100%']
const alignments: Array<[ImageAlignment, typeof AlignLeft]> = [
  ['left', AlignLeft],
  ['center', AlignCenter],
  ['right', AlignRight],
]

export function PreviewImage({
  noteId,
  source,
  alt = '',
  title,
  sourceStart,
  sourceEnd,
  onUpdate,
}: PreviewImageProps) {
  const [attachmentState, setAttachmentState] = useState<{
    dataUrl?: string
    loadError: boolean
  }>({ loadError: false })
  const [selected, setSelected] = useState(false)
  const [caption, setCaption] = useState('')
  const [controlsPosition, setControlsPosition] = useState<{
    left: number
    bottom: number
    width: number
  }>()
  const canvasRef = useRef<HTMLButtonElement>(null)
  const controlsRef = useRef<HTMLDivElement>(null)
  const layout = parseImageLayout(title)
  const isAttachment = source.startsWith(`.attachments/${noteId}/`)

  useEffect(() => {
    let active = true
    if (!isAttachment) return () => { active = false }
    void window.folio.readAttachmentDataUrl(noteId, source).then((value) => {
      if (active) setAttachmentState({ dataUrl: value, loadError: false })
    }).catch(() => {
      if (active) setAttachmentState({ loadError: true })
    })
    return () => { active = false }
  }, [isAttachment, noteId, source])

  useEffect(() => {
    if (!selected) return
    const updatePosition = () => {
      const preview = canvasRef.current?.closest<HTMLElement>('.preview-surface')
      if (!preview) return
      const rect = preview.getBoundingClientRect()
      const width = Math.max(180, Math.min(540, rect.width - 24))
      setControlsPosition({
        left: rect.left + (rect.width - width) / 2,
        bottom: Math.max(12, window.innerHeight - rect.bottom + 12),
        width,
      })
    }
    window.addEventListener('resize', updatePosition)
    return () => window.removeEventListener('resize', updatePosition)
  }, [selected])

  useEffect(() => {
    if (!selected) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (canvasRef.current?.contains(target) || controlsRef.current?.contains(target)) return
      setSelected(false)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer, true)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer, true)
  }, [selected])

  if (!isAttachment) return <img src={source} alt={alt} title={title} />

  const update = (nextCaption: string, width: ImageWidth, align: ImageAlignment) => {
    onUpdate(
      sourceStart,
      sourceEnd,
      attachmentImageMarkdown(source, nextCaption.trim(), { width, align }),
    )
  }
  const dataUrl = isAttachment ? attachmentState.dataUrl : source
  const openControls = () => {
    if (selected) {
      setSelected(false)
      return
    }
    const preview = canvasRef.current?.closest<HTMLElement>('.preview-surface')
    if (preview) {
      const rect = preview.getBoundingClientRect()
      const width = Math.max(180, Math.min(540, rect.width - 24))
      setControlsPosition({
        left: rect.left + (rect.width - width) / 2,
        bottom: Math.max(12, window.innerHeight - rect.bottom + 12),
        width,
      })
    }
    setCaption(alt)
    setSelected(true)
  }

  return (
    <span
      className={`folio-image-block align-${layout.align}${selected ? ' selected' : ''}`}
      style={{ '--folio-image-width': layout.width === 'auto' ? 'max-content' : layout.width } as CSSProperties}
    >
      <button
        ref={canvasRef}
        type="button"
        className="folio-image-canvas"
        onClick={openControls}
        aria-label={selected ? 'Close image controls' : 'Edit image layout'}
      >
        {dataUrl && !attachmentState.loadError ? (
          <img src={dataUrl} alt={alt} />
        ) : (
          <span className="folio-image-missing"><ImageIcon size={22} /> Image unavailable</span>
        )}
      </button>
      {alt && <span className="folio-image-caption">{alt}</span>}
      {selected && controlsPosition && createPortal(
        <div
          ref={controlsRef}
          className="folio-image-controls"
          style={controlsPosition}
          onClick={(event) => event.stopPropagation()}
        >
          <span className="folio-image-widths" aria-label="Image width">
            {widths.map((width) => (
              <button
                type="button"
                className={layout.width === width ? 'active' : ''}
                key={width}
                onClick={() => update(caption, width, layout.align)}
              >
                {width === 'auto' ? 'Auto' : width}
              </button>
            ))}
          </span>
          <span className="folio-image-alignments" aria-label="Image alignment">
            {alignments.map(([alignment, AlignmentIcon]) => (
              <button
                type="button"
                className={layout.align === alignment ? 'active' : ''}
                key={alignment}
                title={`Align ${alignment}`}
                onClick={() => update(caption, layout.width, alignment)}
              >
                <AlignmentIcon size={13} />
              </button>
            ))}
          </span>
          <input
            aria-label="Image caption"
            value={caption}
            placeholder="Add caption"
            onChange={(event) => setCaption(event.target.value)}
            onBlur={() => {
              if (caption.trim() !== alt) update(caption, layout.width, layout.align)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
            }}
          />
        </div>,
        document.body,
      )}
    </span>
  )
}
