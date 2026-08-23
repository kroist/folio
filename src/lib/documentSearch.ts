export interface TextMatch {
  from: number
  to: number
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const findTextMatches = (text: string, query: string): TextMatch[] => {
  if (!query) return []

  const matches: TextMatch[] = []
  const pattern = new RegExp(escapeRegExp(query), 'giu')
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text))) {
    matches.push({ from: match.index, to: match.index + match[0].length })
  }
  return matches
}

export const cycleMatchIndex = (
  current: number,
  matchCount: number,
  direction: 1 | -1,
): number => {
  if (matchCount === 0) return -1
  if (current < 0 || current >= matchCount) return direction === 1 ? 0 : matchCount - 1
  return (current + direction + matchCount) % matchCount
}
