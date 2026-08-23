import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import type { RefObject } from 'react'

interface DocumentFindBarProps {
  inputRef: RefObject<HTMLInputElement | null>
  value: string
  current: number
  count: number
  onChange: (value: string) => void
  onPrevious: () => void
  onNext: () => void
  onClose: () => void
}

export function DocumentFindBar({
  inputRef,
  value,
  current,
  count,
  onChange,
  onPrevious,
  onNext,
  onClose,
}: DocumentFindBarProps) {
  const canNavigate = count > 0
  return (
    <div className="document-find-bar" role="search" aria-label="Find in note">
      <Search size={14} aria-hidden="true" />
      <input
        ref={inputRef}
        aria-label="Find in note"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          if (event.shiftKey) onPrevious()
          else onNext()
        }}
        placeholder="Find"
        autoComplete="off"
        spellCheck={false}
      />
      <output className="document-find-count" aria-live="polite">
        {count > 0 ? `${current + 1} of ${count}` : value ? '0 of 0' : ''}
      </output>
      <button
        type="button"
        aria-label="Previous match"
        title="Previous match (⇧↩)"
        disabled={!canNavigate}
        onClick={onPrevious}
      >
        <ChevronUp size={15} />
      </button>
      <button
        type="button"
        aria-label="Next match"
        title="Next match (↩)"
        disabled={!canNavigate}
        onClick={onNext}
      >
        <ChevronDown size={15} />
      </button>
      <button type="button" aria-label="Close find" title="Close (Esc)" onClick={onClose}>
        <X size={15} />
      </button>
    </div>
  )
}
