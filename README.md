# Folio

A calm, local-first Markdown workspace for macOS. Notes are ordinary Markdown files, search and AI integrations run locally, and an optional iCloud Drive vault keeps the same library available across Macs.

## Download

Download **Folio 1.0.0 for Apple Silicon** from the [GitHub release](https://github.com/kroist/folio/releases/tag/v1.0.0). Open the DMG and drag Folio into Applications.

The 1.0.0 build is ad-hoc signed but not Apple-notarized. On first launch, macOS may require you to control-click Folio, choose **Open**, and confirm. Intel Macs are not supported by this build.

## Features

- A native-feeling three-pane Electron shell
- Local note storage as atomic, portable Markdown files
- CodeMirror 6 Markdown editing
- Edit, split, and preview modes
- GitHub Flavored Markdown and code highlighting
- Search, notebooks, tags, pinning, autosave, and deletion
- Drag reordering with independent manual order for All Notes, each notebook scope, and Pinned
- Collapsible, directory-backed notebooks with drag/drop nesting, icons, and recoverable deletion
- qmd-powered BM25, semantic, and hybrid vault search
- A bundled local MCP server for AI agents, with resources, structured tools, and guarded writes
- Optional iCloud Drive sync for the single canonical vault
- Readable folder backups with guarded restore
- Pasted and dragged images stored in portable per-note attachment folders, with preview controls for size, alignment, and captions
- Path-aware `[[wiki links]]` with notebook-qualified autocomplete and create-on-miss
- Automatic wiki-link target updates when a note is renamed, plus linked-note deletion warnings
- Backlinks for the active note
- A fuzzy `⌘K` palette for notes, navigation, and editor commands
- `/` slash commands for common Markdown blocks
- A selection toolbar for bold, italic, links, inline code, and highlights
- System-aware built-in themes configured from the native Settings window
- System light/dark appearance

## Run locally

Folio requires Node.js 22 or newer.

```bash
npm install
npm run dev
```

By default, the library is stored in Electron's `userData/vault` directory. Enabling iCloud moves that same canonical vault to `iCloud Drive/Folio`; Folio does not create multiple active vaults. Each note is a real Markdown file inside its notebook folder, with Folio metadata in YAML-compatible frontmatter. Manual list ordering is stored separately in `vault/.folio/note-order.json`, so reordering never changes a note's modification date. Deleted notes are moved to `vault/.folio/trash` so deletion remains recoverable. Folio watches the directory and reloads changes synchronized by iCloud or made by another application.

Export Backup creates a dated, directly readable copy of the complete vault. Restore validates the selected backup and preserves the current vault in Electron's `userData/restore-backups` directory before replacing it.

Existing `library.json` data is migrated automatically on first launch. The original JSON file is left untouched as a backup. The renderer has no Node access; it communicates through the typed, isolated preload API in `electron/preload.ts`.

Keyword search builds a local SQLite FTS index on demand. Choosing Meaning or Hybrid lazily downloads qmd's local embedding model (about 300 MB). The derived qmd index is stored in Electron's `userData/search/qmd-index.sqlite`, outside the portable vault, so it is neither synchronized nor included in backups. Notes remain the source of truth; the index can always be rebuilt. qmd runs in a persistent Node 22+ sidecar because its native SQLite module is not ABI-compatible with Electron's embedded Node runtime.

## AI agents and MCP

Folio bundles a local stdio [Model Context Protocol server](https://modelcontextprotocol.io/docs/getting-started/intro). Open **Folio → Settings… → AI Agents** and copy either the Codex configuration or the common JSON configuration into your MCP client. The generated command points at the current Folio executable and bundled server. Each launch resolves the active vault from Folio's settings, so the same configuration follows later moves between local storage and iCloud. Folio does not need to remain open while an agent uses the server.

The server exposes vault and note resources plus tools to:

- inspect vault status and list notebooks or compact note metadata;
- read paged Markdown with outgoing links and backlinks;
- run keyword, local semantic, or hybrid search;
- create notes and notebooks;
- append content, replace an exact fragment, or update note properties;
- rename or move notes and notebooks while preserving Folio wiki links;
- recoverably delete notes or notebooks.

Write tools are distinguished from read-only tools using MCP annotations. Every existing-note mutation requires the exact `updatedAt` value returned by the latest read, preventing a stale agent from silently overwriting a newer version. Destructive tools additionally require the exact note title or notebook name, and deletion still moves content into Folio's trash.

For development or another launcher, the built server can also be started directly:

```bash
node dist-electron/mcp-server.cjs \
  --vault "/absolute/path/to/Folio" \
  --user-data "/absolute/path/to/Folio userData" \
  --qmd-worker "/absolute/path/to/dist-electron/qmd-worker.cjs" \
  --search-index "/absolute/path/to/qmd-index.sqlite"
```

Provide either `--vault` or `--user-data`; when only userData is supplied, the server resolves Folio's current local/iCloud vault. Without the qmd worker and search-index arguments, keyword search uses a lightweight Markdown fallback and semantic/hybrid search is unavailable. Folio gives MCP its own derived qmd SQLite index so app and agent searches never contend for one database. The MCP process never stores notes in that database; it reads and atomically updates the real Markdown vault.

## Verify

```bash
npm run typecheck
npm run lint
npm run test:ci
npm run build
```

To build the Apple Silicon macOS app, DMG, and ZIP locally:

```bash
npm run package:mac
npm run smoke:package:mac
```

## Editor shortcuts

| Action | Shortcut |
| --- | --- |
| Command palette | `⌘K` |
| New note | `⌘N` |
| Bold | `⌘B` |
| Italic | `⌘I` |
| Add link | `⌘⇧K` |
| Inline code | Command + backtick |
| Highlight | `⌘⇧H` |
| Edit / split / preview | `⌘1` / `⌘2` / `⌘3` |

## Next milestones

1. Revision history
2. Markdown folder import
3. Signed and notarized macOS packaging

## Built-in themes

Folio includes adapted versions of the default Code - OSS themes: VS Code Light and Dark, Light and Dark Modern, Light+ and Dark+, Visual Studio Light and Dark, and both High Contrast variants. The System option follows the current macOS appearance. Choose a theme from **Folio → Settings… → Appearance** (`⌘,`).

The palettes are adapted from Microsoft’s MIT-licensed Code - OSS repository; see `THIRD_PARTY_NOTICES.md`.

## License

Folio is available under the [MIT License](./LICENSE). Third-party acknowledgements are in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
