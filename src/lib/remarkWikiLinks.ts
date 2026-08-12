interface MarkdownNode {
  type: string
  value?: string
  url?: string
  children?: MarkdownNode[]
}

const wikiPattern = /\[\[([^\]|\n]+?)(?:\|([^\]\n]+?))?\]\]/g

const splitWikiLinks = (value: string): MarkdownNode[] => {
  const nodes: MarkdownNode[] = []
  let cursor = 0
  let match: RegExpExecArray | null

  wikiPattern.lastIndex = 0
  while ((match = wikiPattern.exec(value))) {
    if (match.index > cursor) nodes.push({ type: 'text', value: value.slice(cursor, match.index) })
    const target = match[1].trim()
    const label = (match[2] ?? target).trim()
    nodes.push({
      type: 'link',
      url: `#folio-note=${encodeURIComponent(target)}`,
      children: [{ type: 'text', value: label }],
    })
    cursor = match.index + match[0].length
  }

  if (cursor < value.length) nodes.push({ type: 'text', value: value.slice(cursor) })
  return nodes
}

const transformNode = (node: MarkdownNode): void => {
  if (!node.children || node.type === 'link' || node.type === 'linkReference') return

  node.children = node.children.flatMap((child) => {
    if (child.type === 'text' && child.value?.includes('[[')) return splitWikiLinks(child.value)
    transformNode(child)
    return child
  })
}

export const remarkWikiLinks = () => (tree: MarkdownNode): void => transformNode(tree)
