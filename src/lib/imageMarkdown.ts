export type ImageAlignment = 'left' | 'center' | 'right'
export type ImageWidth = 'auto' | '25%' | '50%' | '75%' | '100%'

export interface ImageLayout {
  width: ImageWidth
  align: ImageAlignment
}

export const DEFAULT_IMAGE_LAYOUT: ImageLayout = { width: '100%', align: 'center' }

export const parseImageLayout = (title?: string): ImageLayout => {
  const width = /(?:^|;)width=(auto|25%|50%|75%|100%)(?:;|$)/.exec(title ?? '')?.[1]
  const align = /(?:^|;)align=(left|center|right)(?:;|$)/.exec(title ?? '')?.[1]
  return {
    width: (width as ImageWidth | undefined) ?? DEFAULT_IMAGE_LAYOUT.width,
    align: (align as ImageAlignment | undefined) ?? DEFAULT_IMAGE_LAYOUT.align,
  }
}

export const imageLayoutTitle = ({ width, align }: ImageLayout): string =>
  `width=${width};align=${align}`

const escapeCaption = (caption: string): string =>
  caption.replaceAll('\\', '\\\\').replaceAll(']', '\\]')

export const attachmentImageMarkdown = (
  relativePath: string,
  caption = '',
  layout: ImageLayout = DEFAULT_IMAGE_LAYOUT,
): string => `![${escapeCaption(caption)}](${relativePath} "${imageLayoutTitle(layout)}")`

export const replaceMarkdownRange = (
  body: string,
  start: number | undefined,
  end: number | undefined,
  replacement: string,
): string => {
  if (start === undefined || end === undefined || start < 0 || end < start || end > body.length) {
    return body
  }
  return `${body.slice(0, start)}${replacement}${body.slice(end)}`
}
