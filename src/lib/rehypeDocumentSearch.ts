import { findTextMatches } from './documentSearch'

interface HastNode {
  type: string
  value?: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

const splitTextNode = (
  value: string,
  query: string,
  nextIndex: () => number,
  current: number,
): HastNode[] => {
  const matches = findTextMatches(value, query)
  if (matches.length === 0) return [{ type: 'text', value }]

  const nodes: HastNode[] = []
  let cursor = 0
  for (const match of matches) {
    if (match.from > cursor) nodes.push({ type: 'text', value: value.slice(cursor, match.from) })
    const index = nextIndex()
    nodes.push({
      type: 'element',
      tagName: 'mark',
      properties: {
        className: index === current
          ? ['document-find-match', 'document-find-match-current']
          : ['document-find-match'],
        'data-document-find-index': index,
      },
      children: [{ type: 'text', value: value.slice(match.from, match.to) }],
    })
    cursor = match.to
  }
  if (cursor < value.length) nodes.push({ type: 'text', value: value.slice(cursor) })
  return nodes
}

const transformNode = (
  node: HastNode,
  query: string,
  nextIndex: () => number,
  current: number,
): void => {
  if (!node.children) return
  node.children = node.children.flatMap((child) => {
    if (child.type === 'text' && child.value) {
      return splitTextNode(child.value, query, nextIndex, current)
    }
    transformNode(child, query, nextIndex, current)
    return child
  })
}

export const createRehypeDocumentSearch = (query: string, current: number) => () => {
  return (tree: HastNode): void => {
    if (!query) return
    let index = 0
    transformNode(tree, query, () => index++, current)
  }
}
