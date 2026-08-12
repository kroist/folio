import { Check, Copy, FilePenLine, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { McpConfigFormat, McpSetupInfo } from '../types'

export function AgentSettings() {
  const [setup, setSetup] = useState<McpSetupInfo>()
  const [format, setFormat] = useState<McpConfigFormat>('codex')
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    void window.folio.getMcpSetupInfo().then(setSetup).catch((setupError: unknown) => {
      setError(setupError instanceof Error ? setupError.message : 'Could not prepare MCP settings')
    })
  }, [])

  const copy = async () => {
    setError(undefined)
    try {
      await window.folio.copyMcpConfig(format)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1_800)
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : 'Could not copy the configuration')
    }
  }

  if (!setup) {
    return <div className="settings-loading">{error ?? 'Preparing the local MCP server…'}</div>
  }

  const config = format === 'codex' ? setup.codexConfig : setup.jsonConfig

  return (
    <div className="agent-settings-panel">
      <div className="agent-capability-grid">
        <div className="agent-capability-card">
          <Search size={17} />
          <span><strong>Find and understand</strong><small>List, read, link, and search by text or meaning.</small></span>
        </div>
        <div className="agent-capability-card">
          <FilePenLine size={17} />
          <span><strong>Make safe changes</strong><small>Create, append, edit, move, rename, and recoverably delete.</small></span>
        </div>
      </div>

      <div className="agent-setup-card">
        <div className="agent-setup-heading">
          <div>
            <strong>Connect an MCP client</strong>
            <p>Copy this into the client’s MCP configuration, then restart that client.</p>
          </div>
          <div className="agent-format-control" role="group" aria-label="MCP configuration format">
            <button className={format === 'codex' ? 'active' : ''} onClick={() => setFormat('codex')}>Codex</button>
            <button className={format === 'json' ? 'active' : ''} onClick={() => setFormat('json')}>JSON</button>
          </div>
        </div>
        <pre className="agent-config-preview"><code>{config}</code></pre>
        <div className="agent-setup-footer">
          <span title={setup.vaultPath}>Vault: {setup.vaultPath}</span>
          <button className="secondary-button" onClick={() => void copy()}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Copied' : 'Copy configuration'}
          </button>
        </div>
      </div>

      <p className="agent-security-note">
        Folio marks read tools separately from write and destructive tools. Edits require the note’s
        latest timestamp, and deletion also requires its exact title or notebook name. The MCP server
        works directly with the current vault, so Folio does not need to stay open.
      </p>
      {error && <p className="vault-operation-error">{error}</p>}
    </div>
  )
}
