const { execFileSync } = require('node:child_process')
const path = require('node:path')

module.exports = async (context) => {
  if (context.electronPlatformName !== 'darwin') return

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  )

  // A local personal build has no Apple Developer certificate. An ad-hoc
  // signature still gives every nested Mach-O a coherent signature and keeps
  // the Apple Silicon bundle launchable after packaging.
  execFileSync('/usr/bin/codesign', [
    '--force',
    '--deep',
    '--sign',
    '-',
    '--timestamp=none',
    appPath,
  ], { stdio: 'inherit' })
}
