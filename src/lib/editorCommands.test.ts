import { describe, expect, it } from 'vitest'
import { formatSelectionEdit, slashCommandEdit, slashCommands } from './editorCommands'

describe('formatSelectionEdit', () => {
  it('wraps a selection and keeps the inner text selected', () => {
    expect(formatSelectionEdit('hello world', 6, 11, 'bold')).toEqual({
      change: { from: 6, to: 11, insert: '**world**' },
      selection: { anchor: 8, head: 13 },
    })
  })

  it('removes wrappers surrounding a selection', () => {
    expect(formatSelectionEdit('hello **world**', 8, 13, 'bold')).toEqual({
      change: { from: 6, to: 15, insert: 'world' },
      selection: { anchor: 6, head: 11 },
    })
  })

  it('selects the URL placeholder after creating a link', () => {
    expect(formatSelectionEdit('visit Folio', 6, 11, 'link')).toEqual({
      change: { from: 6, to: 11, insert: '[Folio](https://)' },
      selection: { anchor: 14, head: 22 },
    })
  })

  it('highlights each selected line independently', () => {
    expect(formatSelectionEdit('first\nsecond', 0, 12, 'highlight')).toEqual({
      change: { from: 0, to: 12, insert: '==first==\n==second==' },
      selection: { anchor: 0, head: 20 },
    })
  })

  it('toggles a multiline highlight back off', () => {
    const document = '==first==\n==second=='
    expect(formatSelectionEdit(document, 0, document.length, 'highlight')).toEqual({
      change: { from: 0, to: 20, insert: 'first\nsecond' },
      selection: { anchor: 0, head: 12 },
    })
  })
})

describe('slashCommandEdit', () => {
  it('places the cursor inside a fenced code block', () => {
    const command = slashCommands.find((item) => item.id === 'code-block')!
    expect(slashCommandEdit(command, 4, 9)).toEqual({
      change: { from: 4, to: 9, insert: '```\n\n```' },
      selection: { anchor: 8, head: 8 },
    })
  })
})
