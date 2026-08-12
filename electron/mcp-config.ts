export type McpConfigFormat = 'codex' | 'json'

export interface McpLaunchSpec {
  command: string
  args: string[]
  env: Record<string, string>
}

export interface McpSetupInfo {
  vaultPath: string
  serverPath: string
  codexConfig: string
  jsonConfig: string
}

interface McpConfigInput {
  executablePath: string
  serverPath: string
  vaultPath: string
  userDataPath: string
  qmdWorkerPath: string
  searchIndexPath: string
  nodeRuntimePath: string
}

const tomlString = (value: string): string => JSON.stringify(value)

export const buildMcpLaunchSpec = (input: McpConfigInput): McpLaunchSpec => ({
  command: input.executablePath,
  args: [
    input.serverPath,
    '--user-data',
    input.userDataPath,
    '--qmd-worker',
    input.qmdWorkerPath,
    '--search-index',
    input.searchIndexPath,
    '--node-runtime',
    input.nodeRuntimePath,
  ],
  env: { ELECTRON_RUN_AS_NODE: '1' },
})

export const formatCodexMcpConfig = (spec: McpLaunchSpec): string => [
  '[mcp_servers.folio]',
  `command = ${tomlString(spec.command)}`,
  `args = [${spec.args.map(tomlString).join(', ')}]`,
  'startup_timeout_sec = 20',
  'tool_timeout_sec = 300',
  'default_tools_approval_mode = "writes"',
  '',
  '[mcp_servers.folio.env]',
  ...Object.entries(spec.env).map(([name, value]) => `${name} = ${tomlString(value)}`),
].join('\n')

export const formatJsonMcpConfig = (spec: McpLaunchSpec): string => JSON.stringify({
  mcpServers: {
    folio: spec,
  },
}, null, 2)

export const buildMcpSetupInfo = (input: McpConfigInput): McpSetupInfo => {
  const spec = buildMcpLaunchSpec(input)
  return {
    vaultPath: input.vaultPath,
    serverPath: input.serverPath,
    codexConfig: formatCodexMcpConfig(spec),
    jsonConfig: formatJsonMcpConfig(spec),
  }
}
