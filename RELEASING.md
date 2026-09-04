# Releasing Folio

This document describes the manual release process for Folio. Run it from the repository root on the Mac that will produce the release artifacts.

## Current release constraints

- The packaged Node runtime is copied from the build machine, so an Apple Silicon Mac currently produces an `arm64` release.
- Builds are ad-hoc signed by `scripts/after-pack.cjs`, but they are not currently signed with an Apple Developer ID or notarized.
- `asar` is intentionally disabled because the bundled Node sidecar must load qmd and its native dependencies from real files.
- Release artifacts are generated in `release/` and are ignored by Git.
- Folio 1.0.3 and later update application payloads independently of the ad-hoc-signed app bundle. Every published payload must be signed with Folio's Ed25519 update key.

Until Developer ID signing and notarization are configured, every GitHub release must clearly disclose that macOS may require users to control-click Folio, choose **Open**, and confirm.

Version 1.0.3 is the one-time bootstrap release and must be installed manually. App-code updates can then install automatically. Electron, bundled Node, or external native-dependency changes still require a manually installed app release.

## Prerequisites

- Node.js 22 or newer
- npm
- Xcode command-line tools, including `codesign` and `hdiutil`
- GitHub CLI (`gh`) authenticated with access to `kroist/folio`
- A clean `main` branch synchronized with `origin/main`
- Folio's Ed25519 private update key in the macOS Keychain item `com.folio.markdown-editor.update-signing`

Confirm the starting state:

```bash
git status -sb
git pull --ff-only origin main
gh auth status
```

## 1. Choose and record the version

Use semantic versioning. The examples below use `1.0.4`; replace it with the intended version.

Update both `package.json` and `package-lock.json` without creating a tag yet:

```bash
npm version 1.0.4 --no-git-tag-version
```

Add the release date and user-facing changes to `CHANGELOG.md`. Check that the README, supported architecture, and release limitations are still accurate.

## 2. Audit the release contents

Install exactly the locked dependencies and check for known vulnerabilities:

```bash
npm ci
npm audit
```

Review the files that Git will publish. In particular, do not commit vault contents, `.codex/`, downloaded models, SQLite databases, credentials, local settings, or generated release files.

```bash
git status --short --ignored
git diff --check
```

GitHub secret scanning and push protection are enabled, but they supplement rather than replace this review.

## 3. Run the checks

```bash
npm run typecheck
npm run lint
npm run test:ci
npm run build
```

All checks must pass before packaging. Investigate warnings that could affect the packaged application; do not release by simply bypassing a failing check.

## 4. Build the macOS artifacts

```bash
npm run package:mac
npm run sign:update
```

For version `1.0.4` on Apple Silicon, this creates:

- `release/mac-arm64/Folio.app`
- `release/Folio-1.0.4-mac-arm64.dmg`
- `release/Folio-1.0.4-mac-arm64.zip`
- `build/update/Folio-1.0.4-update.zip`
- `build/update/Folio-1.0.4-update.zip.sig`

The package command builds the renderer and Electron processes, creates the update payload, bundles the host Node runtime, applies the ad-hoc signature, and creates the DMG and ZIP. `sign:update` reads the private key from Keychain, confirms it matches `electron/update-key.json`, and signs the payload.

The update ZIP and its signature are mandatory for automatic updates. The DMG and full-app ZIP remain the manual installation path, including for releases that change Electron, bundled Node, or native dependencies.

## 5. Verify the package

Run every packaged-artifact check:

```bash
npm run smoke:package:mac
codesign --verify --deep --strict release/mac-arm64/Folio.app
codesign -dv --verbose=4 release/mac-arm64/Folio.app
hdiutil verify release/Folio-1.0.4-mac-arm64.dmg
unzip -tq release/Folio-1.0.4-mac-arm64.zip
unzip -tq build/update/Folio-1.0.4-update.zip
shasum -a 256 release/Folio-1.0.4-mac-arm64.dmg release/Folio-1.0.4-mac-arm64.zip build/update/Folio-1.0.4-update.zip build/update/Folio-1.0.4-update.zip.sig
```

Record all four SHA-256 values for the release notes.

Before publishing, also install from the DMG and perform a short hands-on test:

- create, edit, rename, move, and delete a note;
- switch between edit, split, and preview modes and confirm scrolling;
- verify keyword search and initialize semantic or hybrid search;
- verify image attachments and wiki links;
- open Settings and confirm the theme, vault, backup, and MCP configuration;
- if available, verify an iCloud Drive vault and MCP access from an agent.
- from the previous payload-updater version, choose **Folio → Check for Updates…** and verify the new version downloads, prompts to restart, preserves an unsaved edit, and relaunches successfully.

Use a disposable test vault. Do not package or upload personal vault data.

## 6. Commit and tag

Review the final diff, then stage source and documentation explicitly. The generated `release/` directory remains untracked.

```bash
git status -sb
git diff --check
git add package.json package-lock.json CHANGELOG.md README.md
git commit -m "Release Folio 1.0.4"
git tag -a v1.0.4 -m "Folio 1.0.4"
```

If the release includes other intentional source changes, add those paths explicitly before committing. Confirm the tag points to the release commit:

```bash
git show --no-patch --decorate v1.0.4
```

Push the commit first and the tag second:

```bash
git push origin main
git push origin v1.0.4
```

Wait for the `main` CI run to succeed:

```bash
gh run list --repo kroist/folio --limit 3
```

## 7. Publish the GitHub release

Write release notes to a Markdown file. Include:

- a concise summary and highlights;
- supported Mac architecture;
- signing and notarization status;
- whether this is the one-time manually installed updater bootstrap release;
- any model download required by semantic search;
- the DMG and ZIP SHA-256 checksums;
- the validation performed.

Create a normal, non-draft release from the existing tag and attach all four artifacts:

```bash
gh release create v1.0.4 \
  release/Folio-1.0.4-mac-arm64.dmg \
  release/Folio-1.0.4-mac-arm64.zip \
  build/update/Folio-1.0.4-update.zip \
  build/update/Folio-1.0.4-update.zip.sig \
  --repo kroist/folio \
  --verify-tag \
  --title "Folio 1.0.4" \
  --notes-file /path/to/release-notes.md
```

Verify that the release is published, is not marked as a prerelease, and has both assets:

```bash
gh release view v1.0.4 --repo kroist/folio
```

Finally, download the published DMG once and confirm that its SHA-256 digest matches the local artifact.

The updater reads the latest normal, published GitHub release. Draft and prerelease builds are not part of the stable update channel. Always attach both the update ZIP and its `.sig`; without either file, clients refuse the release.

## If something goes wrong

- Before pushing, a local tag can be deleted and recreated after fixing the commit.
- After publication, do not silently move or replace a version tag. Fix the problem and publish a new patch release.
- If an uploaded asset is corrupt but the tagged source is correct, document the incident clearly before replacing the asset.
- If credentials or personal data are discovered, remove or rotate them immediately. Deleting a file in a later commit does not remove it from Git history.

## Enabling Apple-trusted distribution

To remove Gatekeeper's first-launch warning, configure a Developer ID Application certificate, hardened runtime entitlements, and Apple notarization. Confirm that `codesign -dv` reports the expected Developer ID authority instead of an ad-hoc signature.

Once that is working, remove the ad-hoc-signing warning from this document, the README, and the GitHub release template. Folio's Ed25519 payload verification remains in place independently of Apple signing.
