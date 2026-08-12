export type FormatKind = 'bold' | 'italic' | 'link' | 'code' | 'highlight'

export interface TextEdit {
  change: {
    from: number
    to: number
    insert: string
  }
  selection: {
    anchor: number
    head: number
  }
}

export interface SlashCommand {
  id: string
  label: string
  detail: string
  keywords: string
  kind: 'heading' | 'list' | 'task' | 'quote' | 'code' | 'callout' | 'divider'
  template: string
  cursorOffset: number
}

export const slashCommands: SlashCommand[] = [
  {
    id: 'heading-1',
    label: 'Heading 1',
    detail: '# Big section heading',
    keywords: 'h1 title heading',
    kind: 'heading',
    template: '# ',
    cursorOffset: 2,
  },
  {
    id: 'heading-2',
    label: 'Heading 2',
    detail: '## Section heading',
    keywords: 'h2 heading',
    kind: 'heading',
    template: '## ',
    cursorOffset: 3,
  },
  {
    id: 'heading-3',
    label: 'Heading 3',
    detail: '### Small heading',
    keywords: 'h3 heading',
    kind: 'heading',
    template: '### ',
    cursorOffset: 4,
  },
  {
    id: 'bullet-list',
    label: 'Bulleted list',
    detail: 'Create a simple list',
    keywords: 'unordered bullet list',
    kind: 'list',
    template: '- ',
    cursorOffset: 2,
  },
  {
    id: 'numbered-list',
    label: 'Numbered list',
    detail: 'Create an ordered list',
    keywords: 'ordered numbered list',
    kind: 'list',
    template: '1. ',
    cursorOffset: 3,
  },
  {
    id: 'task',
    label: 'Task',
    detail: 'Add an unchecked task',
    keywords: 'todo checkbox task',
    kind: 'task',
    template: '- [ ] ',
    cursorOffset: 6,
  },
  {
    id: 'quote',
    label: 'Blockquote',
    detail: 'Add a quoted passage',
    keywords: 'quote blockquote',
    kind: 'quote',
    template: '> ',
    cursorOffset: 2,
  },
  {
    id: 'code-block',
    label: 'Code block',
    detail: 'Insert a fenced block',
    keywords: 'fence code programming',
    kind: 'code',
    template: '```\n\n```',
    cursorOffset: 4,
  },
  {
    id: 'callout',
    label: 'Note callout',
    detail: 'Insert a GitHub-style alert',
    keywords: 'alert note callout',
    kind: 'callout',
    template: '> [!NOTE]\n> ',
    cursorOffset: 12,
  },
  {
    id: 'divider',
    label: 'Divider',
    detail: 'Insert a horizontal rule',
    keywords: 'separator horizontal rule divider',
    kind: 'divider',
    template: '---\n',
    cursorOffset: 4,
  },
]

const wrappers: Record<Exclude<FormatKind, 'link'>, [string, string]> = {
  bold: ['**', '**'],
  italic: ['_', '_'],
  code: ['`', '`'],
  highlight: ['==', '=='],
}

export const toggleWrapEdit = (
  document: string,
  from: number,
  to: number,
  prefix: string,
  suffix: string,
): TextEdit => {
  const selected = document.slice(from, to)
  const selectedHasWrappers = selected.startsWith(prefix) && selected.endsWith(suffix)
  const surroundingHasWrappers =
    document.slice(Math.max(0, from - prefix.length), from) === prefix &&
    document.slice(to, to + suffix.length) === suffix

  if (selectedHasWrappers && selected.length >= prefix.length + suffix.length) {
    const inner = selected.slice(prefix.length, selected.length - suffix.length)
    return {
      change: { from, to, insert: inner },
      selection: { anchor: from, head: from + inner.length },
    }
  }

  if (surroundingHasWrappers) {
    return {
      change: { from: from - prefix.length, to: to + suffix.length, insert: selected },
      selection: { anchor: from - prefix.length, head: to - prefix.length },
    }
  }

  const insert = `${prefix}${selected}${suffix}`
  return {
    change: { from, to, insert },
    selection: { anchor: from + prefix.length, head: to + prefix.length },
  }
}

export const formatSelectionEdit = (
  document: string,
  from: number,
  to: number,
  kind: FormatKind,
): TextEdit => {
  if (kind === 'highlight' && document.slice(from, to).includes('\n')) {
    const selected = document.slice(from, to)
    const lines = selected.split('\n')
    const contentLines = lines.filter(Boolean)
    const allWrapped =
      contentLines.length > 0 &&
      contentLines.every(
        (line) => line.startsWith('==') && line.endsWith('==') && line.length >= 4,
      )
    const insert = lines
      .map((line) => {
        if (!line) return line
        return allWrapped ? line.slice(2, -2) : `==${line}==`
      })
      .join('\n')
    return {
      change: { from, to, insert },
      selection: { anchor: from, head: from + insert.length },
    }
  }

  if (kind !== 'link') {
    const [prefix, suffix] = wrappers[kind]
    return toggleWrapEdit(document, from, to, prefix, suffix)
  }

  const selected = document.slice(from, to)
  const insert = `[${selected}](https://)`
  const urlFrom = from + selected.length + 3
  return {
    change: { from, to, insert },
    selection: { anchor: urlFrom, head: urlFrom + 'https://'.length },
  }
}

export const slashCommandEdit = (
  command: SlashCommand,
  from: number,
  to: number,
): TextEdit => ({
  change: { from, to, insert: command.template },
  selection: {
    anchor: from + command.cursorOffset,
    head: from + command.cursorOffset,
  },
})
