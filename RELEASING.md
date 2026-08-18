# Releasing Folio

This document describes the manual release process for Folio. Run it from the repository root on the Mac that will produce the release artifacts.

## Current release constraints

- The packaged Node runtime is copied from the build machine, so an Apple Silicon Mac currently produces an `arm64` release.
- Builds are ad-hoc signed by `scripts/after-pack.cjs`, but they are not currently signed with an Apple Developer ID or notarized.
- `asar` is intentionally disabled because the bundled Node sidecar must load qmd and its native dependencies from real files.
- Release artifacts are generated in `release/` and are ignored by Git.
- Folio contains an automatic updater, but Squirrel.Mac requires every installed and downloaded build to use a valid, consistent Apple Developer ID signature. Ad-hoc-signed builds must not be advertised as automatically updatable.

Until Developer ID signing and notarization are configured, every GitHub release must clearly disclose that macOS may require users to control-click Folio, choose **Open**, and confirm.

The first updater-enabled, Developer-ID-signed release is a bootstrap release: users on 1.0.0 must install it manually. Automatic updates can only carry users from that signed release to later releases signed by the same identity.

## Prerequisites

- Node.js 22 or newer
- npm
- Xcode command-line tools, including `codesign` and `hdiutil`
- GitHub CLI (`gh`) authenticated with access to `kroist/folio`
- A clean `main` branch synchronized with `origin/main`
- For an automatic-update-capable public release, a Developer ID Application certificate available to electron-builder and Apple notarization credentials

Confirm the starting state:

```bash
git status -sb
git pull --ff-only origin main
gh auth status
```

## 1. Choose and record the version

Use semantic versioning. The examples below use `1.0.1`; replace it with the intended version.

Update both `package.json` and `package-lock.json` without creating a tag yet:

```bash
npm version 1.0.1 --no-git-tag-version
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
```

For version `1.0.1` on Apple Silicon, this creates:

- `release/mac-arm64/Folio.app`
- `release/Folio-1.0.1-mac-arm64.dmg`
- `release/Folio-1.0.1-mac-arm64.zip`

The command builds the renderer and Electron processes, bundles the host Node runtime, packages the app, applies the ad-hoc signature, and creates the DMG and ZIP.

The ZIP is mandatory: the update service serves it to Squirrel.Mac. Keep the DMG and ZIP from the same build together. A production updater release must replace the ad-hoc signature with a consistent Developer ID signature and be notarized before publication.

## 5. Verify the package

Run every packaged-artifact check:

```bash
npm run smoke:package:mac
codesign --verify --deep --strict release/mac-arm64/Folio.app
codesign -dv --verbose=4 release/mac-arm64/Folio.app
hdiutil verify release/Folio-1.0.1-mac-arm64.dmg
unzip -tq release/Folio-1.0.1-mac-arm64.zip
shasum -a 256 release/Folio-1.0.1-mac-arm64.dmg release/Folio-1.0.1-mac-arm64.zip
```

Record both SHA-256 values for the release notes.

Before publishing, also install from the DMG and perform a short hands-on test:

- create, edit, rename, move, and delete a note;
- switch between edit, split, and preview modes and confirm scrolling;
- verify keyword search and initialize semantic or hybrid search;
- verify image attachments and wiki links;
- open Settings and confirm the theme, vault, backup, and MCP configuration;
- if available, verify an iCloud Drive vault and MCP access from an agent.
- from the previous signed version, choose **Folio → Check for Updates…** and verify the new version downloads, prompts to restart, preserves an unsaved edit, and relaunches successfully.

Use a disposable test vault. Do not package or upload personal vault data.

## 6. Commit and tag

Review the final diff, then stage source and documentation explicitly. The generated `release/` directory remains untracked.

```bash
git status -sb
git diff --check
git add package.json package-lock.json CHANGELOG.md README.md
git commit -m "Release Folio 1.0.1"
git tag -a v1.0.1 -m "Folio 1.0.1"
```

If the release includes other intentional source changes, add those paths explicitly before committing. Confirm the tag points to the release commit:

```bash
git show --no-patch --decorate v1.0.1
```

Push the commit first and the tag second:

```bash
git push origin main
git push origin v1.0.1
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

Create a normal, non-draft release from the existing tag and attach both artifacts:

```bash
gh release create v1.0.1 \
  release/Folio-1.0.1-mac-arm64.dmg \
  release/Folio-1.0.1-mac-arm64.zip \
  --repo kroist/folio \
  --verify-tag \
  --title "Folio 1.0.1" \
  --notes-file /path/to/release-notes.md
```

Verify that the release is published, is not marked as a prerelease, and has both assets:

```bash
gh release view v1.0.1 --repo kroist/folio
```

Finally, download the published DMG once and confirm that its SHA-256 digest matches the local artifact.

The updater reads normal, published releases from `update.electronjs.org/kroist/folio`. Draft and prerelease builds are not part of the stable update channel. Always attach the ZIP; publishing only the DMG leaves macOS clients with no update payload.

## If something goes wrong

- Before pushing, a local tag can be deleted and recreated after fixing the commit.
- After publication, do not silently move or replace a version tag. Fix the problem and publish a new patch release.
- If an uploaded asset is corrupt but the tagged source is correct, document the incident clearly before replacing the asset.
- If credentials or personal data are discovered, remove or rotate them immediately. Deleting a file in a later commit does not remove it from Git history.

## Enabling signed automatic updates

Before relying on automatic updates, configure a Developer ID Application certificate, hardened runtime entitlements, and Apple notarization. Confirm that `codesign -dv` reports the expected Developer ID authority instead of an ad-hoc signature and test an update from one published version to the next. Use the same signing identity for every update.

Once that is working, remove the ad-hoc-signing warning from this document, the README, and the GitHub release template. Do not ship an updater-enabled release as automatic-update-capable until this end-to-end signed update test passes.
