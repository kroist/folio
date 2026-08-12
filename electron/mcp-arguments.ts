import path from 'node:path'
import type { FolioMcpOptions } from './mcp'
import { VaultLocations } from './vault'

interface ParsedMcpArguments {
  vaultPath?: string
  userDataPath: string
  qmdWorkerPath?: string
  searchIndexPath?: string
  nodeRuntimePath?: string
}

const argumentValue = (args: string[], name: string): string | undefined => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

export const parseMcpArguments = (
  args: string[],
  environment: Record<string, string | undefined> = process.env,
): ParsedMcpArguments => {
  const vaultPath = argumentValue(args, '--vault') ?? environment.FOLIO_VAULT_PATH
  const userDataPath = argumentValue(args, '--user-data')
    ?? environment.FOLIO_USER_DATA_PATH
    ?? (vaultPath ? path.join(path.resolve(vaultPath), '.folio') : undefined)
  if (!userDataPath) {
    throw new Error('Missing --user-data or --vault path (or the matching Folio environment variable)')
  }
  const qmdWorkerPath = argumentValue(args, '--qmd-worker') ?? environment.FOLIO_QMD_WORKER_PATH
  const searchIndexPath = argumentValue(args, '--search-index') ?? environment.FOLIO_SEARCH_INDEX_PATH
  const nodeRuntimePath = argumentValue(args, '--node-runtime') ?? environment.FOLIO_NODE_RUNTIME_PATH
  if (Boolean(qmdWorkerPath) !== Boolean(searchIndexPath)) {
    throw new Error('--qmd-worker and --search-index must be provided together')
  }
  return {
    userDataPath: path.resolve(userDataPath),
    ...(vaultPath ? { vaultPath: path.resolve(vaultPath) } : {}),
    ...(qmdWorkerPath ? { qmdWorkerPath: path.resolve(qmdWorkerPath) } : {}),
    ...(searchIndexPath ? { searchIndexPath: path.resolve(searchIndexPath) } : {}),
    ...(nodeRuntimePath ? { nodeRuntimePath: path.resolve(nodeRuntimePath) } : {}),
  }
}

export const resolveMcpOptions = async (
  args: string[],
  environment: Record<string, string | undefined> = process.env,
  homePath: string,
): Promise<FolioMcpOptions> => {
  const parsed = parseMcpArguments(args, environment)
  const vaultPath = parsed.vaultPath
    ?? await new VaultLocations(parsed.userDataPath, homePath).readVaultPath()
  return { ...parsed, vaultPath }
}
