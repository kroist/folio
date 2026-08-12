import { homedir } from 'node:os'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { resolveMcpOptions } from './mcp-arguments'
import { createFolioMcpServer, FolioMcpService } from './mcp'

const run = async (): Promise<void> => {
  const service = new FolioMcpService(
    await resolveMcpOptions(process.argv.slice(2), process.env, homedir()),
  )
  await service.validate()
  const handle = serveStdio(() => createFolioMcpServer(service), {
    onerror: (error) => console.error(`[folio-mcp] ${error.message}`),
  })
  const close = async () => {
    await service.close()
    await handle.close()
  }
  process.once('SIGINT', () => void close())
  process.once('SIGTERM', () => void close())
}

void run().catch((error: unknown) => {
  console.error(`[folio-mcp] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
