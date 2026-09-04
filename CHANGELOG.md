# Changelog

All notable changes to Folio are documented here.

## [1.1.0] - 2026-09-04

### Added

- Added a dedicated macOS update window with release notes, skip and reminder actions, automatic-update preferences, and in-place download and restart states

## [1.0.3] - 2026-09-04

### Fixed

- Replaced the macOS-signature-dependent updater with Folio's own Ed25519-verified payload updater
- Added atomic activation and load fallback so invalid updates preserve the last working version

## [1.0.2] - 2026-08-23

### Added

- Added Chrome-style in-note search across the editor and rendered Markdown preview
- Added shared match highlighting in split view with forward and backward keyboard navigation

## [1.0.1] - 2026-08-18

### Fixed

- Restored trackpad scrolling in the notes list on macOS

### Added

- Automatic update checks through Folio's public GitHub Releases, with a manual check command and restart prompt

## [1.0.0] - 2026-08-12

Folio's first public release.

### Highlights

- Local-first Markdown vaults with optional iCloud Drive sync and readable backups
- CodeMirror editing with edit, split, and preview modes
- Nested notebooks, manual note ordering, pins, tags, backlinks, and path-aware wiki links
- Local keyword, semantic, and hybrid search powered by qmd
- Image attachments with resizing, alignment, and captions
- Native settings, shared editor/preview themes, command palette, and slash commands
- Bundled MCP server with guarded read/write tools for AI agents
- Apple Silicon macOS packaging as a DMG and ZIP

[1.1.0]: https://github.com/kroist/folio/releases/tag/v1.1.0
[1.0.3]: https://github.com/kroist/folio/releases/tag/v1.0.3
[1.0.2]: https://github.com/kroist/folio/releases/tag/v1.0.2
[1.0.1]: https://github.com/kroist/folio/releases/tag/v1.0.1
[1.0.0]: https://github.com/kroist/folio/releases/tag/v1.0.0
