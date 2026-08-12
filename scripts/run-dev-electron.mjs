import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const projectPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const electronExecutable = require('electron')

const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `${command} failed`)
  }
}

const prepareMacDevelopmentApp = async () => {
  const electronVersion = require('electron/package.json').version
  const sourceApp = path.resolve(path.dirname(electronExecutable), '../..')
  const developmentRoot = path.join(projectPath, 'build', 'dev')
  const developmentApp = path.join(developmentRoot, 'Folio.app')
  const developmentExecutable = path.join(developmentApp, 'Contents', 'MacOS', 'Electron')
  const sourceIcon = path.join(projectPath, 'build', 'icon.icns')
  const markerPath = path.join(developmentRoot, '.runtime.json')
  const signature = createHash('sha256')
    .update(electronVersion)
    .update(await readFile(sourceIcon))
    .digest('hex')

  try {
    const marker = JSON.parse(await readFile(markerPath, 'utf8'))
    await readFile(developmentExecutable)
    if (marker.signature === signature) return developmentExecutable
  } catch {
    // The generated development bundle is missing or stale.
  }

  await mkdir(developmentRoot, { recursive: true })
  await rm(developmentApp, { recursive: true, force: true })
  run('/bin/cp', ['-cR', sourceApp, developmentApp])

  const infoPlist = path.join(developmentApp, 'Contents', 'Info.plist')
  const resourcesPath = path.join(developmentApp, 'Contents', 'Resources')
  await copyFile(sourceIcon, path.join(resourcesPath, 'Folio.icns'))
  run('/usr/bin/plutil', ['-replace', 'CFBundleName', '-string', 'Folio', infoPlist])
  run('/usr/bin/plutil', ['-replace', 'CFBundleDisplayName', '-string', 'Folio', infoPlist])
  run('/usr/bin/plutil', [
    '-replace', 'CFBundleIdentifier', '-string', 'com.folio.markdown-editor.dev', infoPlist,
  ])
  run('/usr/bin/plutil', ['-replace', 'CFBundleIconFile', '-string', 'Folio.icns', infoPlist])
  run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', developmentApp])
  await writeFile(markerPath, `${JSON.stringify({ signature, electronVersion }, null, 2)}\n`)
  return developmentExecutable
}

const executable = process.platform === 'darwin'
  ? await prepareMacDevelopmentApp()
  : electronExecutable

if (process.argv.includes('--prepare-only')) {
  console.log(executable)
  process.exit(0)
}

const child = spawn(executable, [projectPath], {
  cwd: projectPath,
  env: { ...process.env, VITE_DEV_SERVER_URL: 'http://localhost:5173' },
  stdio: 'inherit',
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}

child.on('error', (error) => {
  console.error(error)
  process.exitCode = 1
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
