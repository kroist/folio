import { describe, expect, it } from 'vitest'
import {
  buildMcpLaunchSpec,
  buildMcpSetupInfo,
  formatCodexMcpConfig,
} from './mcp-config'

const input = {
  executablePath: '/Applications/Folio.app/Contents/MacOS/Folio',
  serverPath: '/Applications/Folio.app/Contents/Resources/app.asar/dist-electron/mcp-server.cjs',
  vaultPath: '/Users/me/Library/Mobile Documents/com~apple~CloudDocs/Folio',
  userDataPath: '/Users/me/Library/Application Support/folio-markdown-editor',
  qmdWorkerPath: '/Applications/Folio.app/Contents/Resources/app.asar/dist-electron/qmd-worker.cjs',
  searchIndexPath: '/Users/me/Library/Application Support/folio-markdown-editor/search/qmd-index.sqlite',
  nodeRuntimePath: '/Applications/Folio.app/Contents/Resources/runtime/node',
}

describe('Folio MCP configuration', () => {
  it('launches the bundled server through Electron in Node mode', () => {
    const spec = buildMcpLaunchSpec(input)
    expect(spec.command).toBe(input.executablePath)
    expect(spec.env).toEqual({ ELECTRON_RUN_AS_NODE: '1' })
    expect(spec.args).not.toContain(input.vaultPath)
    expect(spec.args).toContain(input.userDataPath)
    expect(spec.args).toContain(input.nodeRuntimePath)
    expect(spec.args[0]).toBe(input.serverPath)
  })

  it('produces valid JSON and a Codex configuration with write approvals', () => {
    const setup = buildMcpSetupInfo(input)
    expect(JSON.parse(setup.jsonConfig)).toEqual({
      mcpServers: { folio: buildMcpLaunchSpec(input) },
    })
    expect(setup.codexConfig).toContain('[mcp_servers.folio]')
    expect(setup.codexConfig).toContain('default_tools_approval_mode = "writes"')
    expect(setup.codexConfig).toContain('[mcp_servers.folio.env]')
  })

  it('escapes paths using TOML-compatible quoted strings', () => {
    const config = formatCodexMcpConfig({
      command: '/A "quoted" app',
      args: ['a\\b', 'line\nbreak'],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    })
    expect(config).toContain('command = "/A \\"quoted\\" app"')
    expect(config).toContain('"a\\\\b"')
    expect(config).toContain('"line\\nbreak"')
  })
})
