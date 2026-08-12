import type { Notebook } from '../types'

export interface NotebookTreeItem {
  notebook: Notebook
  depth: number
}

export const notebookDescendantIds = (notebooks: Notebook[], id: string): Set<string> => {
  const descendants = new Set<string>([id])
  let changed = true
  while (changed) {
    changed = false
    for (const notebook of notebooks) {
      if (notebook.parentId && descendants.has(notebook.parentId) && !descendants.has(notebook.id)) {
        descendants.add(notebook.id)
        changed = true
      }
    }
  }
  return descendants
}

export const flattenNotebooks = (
  notebooks: Notebook[],
  collapsedIds: ReadonlySet<string> = new Set(),
): NotebookTreeItem[] => {
  const items: NotebookTreeItem[] = []
  const visited = new Set<string>()
  const hideDescendants = (parentId: string) => {
    for (const notebook of notebooks) {
      if (notebook.parentId !== parentId || visited.has(notebook.id)) continue
      visited.add(notebook.id)
      hideDescendants(notebook.id)
    }
  }
  const append = (parentId: string | undefined, depth: number) => {
    for (const notebook of notebooks) {
      if (notebook.parentId !== parentId || visited.has(notebook.id)) continue
      visited.add(notebook.id)
      items.push({ notebook, depth })
      if (collapsedIds.has(notebook.id)) hideDescendants(notebook.id)
      else append(notebook.id, depth + 1)
    }
  }
  append(undefined, 0)
  for (const notebook of notebooks) {
    if (visited.has(notebook.id)) continue
    items.push({ notebook, depth: 0 })
  }
  return items
}

export const notebookPathLabel = (notebooks: Notebook[], id: string): string => {
  const byId = new Map(notebooks.map((notebook) => [notebook.id, notebook]))
  const labels: string[] = []
  const visited = new Set<string>()
  let current = byId.get(id)
  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    labels.unshift(current.name)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return labels.join(' / ')
}
