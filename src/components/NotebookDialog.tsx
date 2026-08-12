import { X } from 'lucide-react'
import { useState } from 'react'
import type { Notebook } from '../types'
import { icons } from './Icon'

interface NotebookDialogProps {
  notebook?: Notebook
  parentName?: string
  onClose: () => void
  onSubmit: (name: string, icon: string) => Promise<void>
}

const iconOptions = Object.entries(icons)

export function NotebookDialog({
  notebook,
  parentName,
  onClose,
  onSubmit,
}: NotebookDialogProps) {
  const [name, setName] = useState(notebook?.name ?? '')
  const [icon, setIcon] = useState(notebook?.icon ?? 'folder')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()

  const submit = async () => {
    if (!name.trim() || saving) return
    setSaving(true)
    setError(undefined)
    try {
      await onSubmit(name, icon)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not save notebook')
      setSaving(false)
    }
  }

  return (
    <div className="notebook-dialog-backdrop" onMouseDown={onClose}>
      <form
        className="notebook-dialog"
        aria-label={notebook ? 'Edit notebook' : 'New notebook'}
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <header>
          <div>
            <h2>{notebook ? 'Edit notebook' : parentName ? 'New sub-notebook' : 'New notebook'}</h2>
            {parentName && <p>Inside {parentName}</p>}
          </div>
          <button type="button" className="icon-button" title="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <label className="notebook-name-field">
          <span>Name</span>
          <input
            autoFocus
            maxLength={80}
            value={name}
            placeholder="Notebook name"
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        <fieldset className="notebook-icon-field">
          <legend>Icon</legend>
          <div>
            {iconOptions.map(([value, Icon]) => (
              <button
                type="button"
                className={icon === value ? 'active' : ''}
                key={value}
                title={value}
                aria-label={`${value} icon`}
                onClick={() => setIcon(value)}
              >
                <Icon size={18} />
              </button>
            ))}
          </div>
        </fieldset>

        {error && <p className="notebook-dialog-error">{error}</p>}
        <footer>
          <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary-button" disabled={!name.trim() || saving}>
            {saving ? 'Saving…' : notebook ? 'Save' : 'Create'}
          </button>
        </footer>
      </form>
    </div>
  )
}
