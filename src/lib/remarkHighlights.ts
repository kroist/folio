interface MarkdownNode {
  type: string
  value?: string
  data?: { hName?: string }
  children?: MarkdownNode[]
}

const highlightPattern = /==([\s\S]+?)==/g

const splitHighlights = (value: string): MarkdownNode[] => {
  const nodes: MarkdownNode[] = []
  let cursor = 0
  let match: RegExpExecArray | null

  highlightPattern.lastIndex = 0
  while ((match = highlightPattern.exec(value))) {
    if (match.index > cursor) nodes.push({ type: 'text', value: value.slice(cursor, match.index) })
    nodes.push({
      type: 'emphasis',
      data: { hName: 'mark' },
      children: [{ type: 'text', value: match[1] }],
    })
    cursor = match.index + match[0].length
  }

  if (cursor < value.length) nodes.push({ type: 'text', value: value.slice(cursor) })
  return nodes
}

const transformNode = (node: MarkdownNode): void => {
  if (!node.children || node.type === 'link' || node.type === 'linkReference') return

  node.children = node.children.flatMap((child) => {
    if (child.type === 'text' && child.value?.includes('==')) return splitHighlights(child.value)
    transformNode(child)
    return child
  })
}

export const remarkHighlights = () => (tree: MarkdownNode): void => transformNode(tree)
