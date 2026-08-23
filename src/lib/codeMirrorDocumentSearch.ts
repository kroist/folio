import { StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'
import { findTextMatches } from './documentSearch'

interface DocumentFindState {
  query: string
  current: number
  decorations: DecorationSet
}

interface SetDocumentFindValue {
  query: string
  current: number
}

const setDocumentFindEffect = StateEffect.define<SetDocumentFindValue>()

const buildDocumentFindState = (
  document: string,
  query: string,
  current: number,
): DocumentFindState => {
  const matches = findTextMatches(document, query)
  const decorations = matches.map((match, index) =>
    Decoration.mark({
      class: index === current
        ? 'document-find-match document-find-match-current'
        : 'document-find-match',
    }).range(match.from, match.to))

  return {
    query,
    current,
    decorations: Decoration.set(decorations, true),
  }
}

const documentFindField = StateField.define<DocumentFindState>({
  create: () => ({ query: '', current: -1, decorations: Decoration.none }),
  update: (value, transaction) => {
    let query = value.query
    let current = value.current
    let findChanged = false
    for (const effect of transaction.effects) {
      if (!effect.is(setDocumentFindEffect)) continue
      query = effect.value.query
      current = effect.value.current
      findChanged = true
    }
    return transaction.docChanged || findChanged
      ? buildDocumentFindState(transaction.state.doc.toString(), query, current)
      : value
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
})

export const documentFindExtension: Extension = documentFindField

export const updateDocumentFind = (
  view: EditorView,
  query: string,
  current: number,
  scrollToCurrent = false,
): void => {
  const effects: StateEffect<unknown>[] = [setDocumentFindEffect.of({ query, current })]
  if (scrollToCurrent) {
    const match = findTextMatches(view.state.doc.toString(), query)[current]
    if (match) {
      effects.push(EditorView.scrollIntoView(match.from, { y: 'center', yMargin: 70 }))
    }
  }
  view.dispatch({ effects })
}
