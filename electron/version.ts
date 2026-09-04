const versionPattern = /^v?(\d+)\.(\d+)\.(\d+)$/

export const isNewerVersion = (candidate: string, current: string): boolean => {
  const left = versionPattern.exec(candidate)?.slice(1).map(Number)
  const right = versionPattern.exec(current)?.slice(1).map(Number)
  if (!left || !right) return false
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index]
  }
  return false
}
