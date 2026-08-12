import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseMcpArguments, resolveMcpOptions } from './mcp-arguments'

describe('Folio MCP arguments', () => {
  it('requires an explicit vault and resolves optional qmd paths', () => {
    expect(() => parseMcpArguments([], {})).toThrow('Missing --user-data or --vault')
    const options = parseMcpArguments([
      '--vault', '/tmp/Folio',
      '--user-data', '/tmp/Folio Data',
      '--qmd-worker', './worker.cjs',
      '--search-index', './search.sqlite',
      '--node-runtime', './node',
    ], {})
    expect(options).toEqual({
      vaultPath: '/tmp/Folio',
      userDataPath: '/tmp/Folio Data',
      qmdWorkerPath: path.resolve('./worker.cjs'),
      searchIndexPath: path.resolve('./search.sqlite'),
      nodeRuntimePath: path.resolve('./node'),
    })
  })

  it('accepts environment configuration and rejects half-configured semantic search', () => {
    expect(parseMcpArguments([], {
      FOLIO_VAULT_PATH: '/tmp/Folio',
    })).toMatchObject({ vaultPath: '/tmp/Folio' })
    expect(() => parseMcpArguments(['--vault', '/tmp/Folio', '--qmd-worker', '/tmp/worker'], {}))
      .toThrow('must be provided together')
  })

  it('resolves the current vault from Folio userData settings', async () => {
    const options = await resolveMcpOptions(['--user-data', '/tmp/Folio Data'], {}, '/Users/me')
    expect(options).toMatchObject({
      userDataPath: '/tmp/Folio Data',
      vaultPath: '/tmp/Folio Data/vault',
    })
  })
})
