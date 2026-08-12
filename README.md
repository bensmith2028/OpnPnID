# OpnPnID

A desktop P&ID (piping & instrumentation diagram) schematic editor, built with Tauri +
React + TypeScript. Draw schematics on a snapped canvas, place components from a
component library (families → categories → real manufacturer parts, each with its own
configurable attribute schema), and export to PDF or a bill of materials.

## Features

- **Drawing** — points, lines, arcs, and circles on a grid-snapped canvas, with
  select/drag, undo/redo, and full copy/paste (including lines/arcs attached to
  component ports).
- **Component library** — a three-level hierarchy: **Family** (Valve, Pump, …, a loose
  ISA-tag grouping) → **Category** (Automated 2-Way Valve — owns the symbol, port
  count, and its own attribute schema) → **Real Part** (a specific
  manufacturer/model with configurable specs, datasheet link, price). A built-in
  drawing editor lets you sketch or upload a category's symbol and mark its
  connection ports.
- **Export** — PDF export and a BOM (bill of materials) CSV export, plus native
  project save/load (`.json`-based project files via the OS file dialogs).
- **Shared organization library** — the library can be backed by a plain folder of
  JSON files instead of only this machine's local database, so it can be versioned,
  shared, and grown over time without touching this repo. See
  [Connecting a library folder](#connecting-a-library-folder) below.

## Requirements

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/tools/install) (stable toolchain) — needed by
  Tauri to build the native shell
- Platform build tools for [Tauri prerequisites](https://tauri.app/start/prerequisites/)
  (Xcode Command Line Tools on macOS, etc.)

## Getting started

```bash
npm install
npm run tauri dev    # launches the app with hot reload
```

Other useful commands:

```bash
npm run build         # tsc + vite production build
npm run tauri build   # produces a native installer/bundle
npm test              # runs the vitest suite
```

On first launch, a local `library.db` SQLite file is created automatically (in the
OS app-data directory) with a small built-in starter set of families/categories — the
app is fully usable with no further setup. Everything below is about optionally
connecting a **shared, git-ignored library folder** on top of that.

## Connecting a library folder

By default, everything you add to the Component Library (families, categories, real
parts, symbols) lives only in that local `library.db` on your machine. To build a
library that can be **shared across an organization, backed up, and grown over time**
(e.g. by importing manufacturer catalogs — see below), connect a library folder:

1. Open the **Component Library** panel and click **Connect Library Folder…**.
2. Pick (or create) a folder — a `library-data/` folder inside this repo works out of
   the box, since it's already listed in `.gitignore`. It doesn't need to be inside the
   repo at all; point it at a shared drive, a cloud-synced folder, or your org's own
   private data repo instead if you'd rather distribute it that way.
3. The app immediately syncs: it creates the folder structure if empty, or reads
   whatever's already there into your local `library.db`.

From then on, every edit you make in the Library panel is written to **both** your
local sqlite cache (fast to query) **and** the folder (the actual source of truth) —
so the folder always reflects the current state of the library. Click **Sync Now** any
time to re-read the folder (e.g. after a teammate updates it, or a `git pull` /
cloud-sync brings in changes) without restarting the app.

### Why a folder instead of just the database

- **Diffable and mergeable.** One JSON file per family/category/symbol/part means git
  (or any diff tool) shows exactly what changed, and two people editing different
  parts rarely conflict.
- **Physical parts stay out of this repo.** Real, manufacturer-specific part data
  (scraped from catalogs, possibly large or licensed) never enters this codebase's git
  history — the whole `library-data/` folder is git-ignored. How your organization
  distributes it (shared drive, its own private repo, cloud sync) is entirely up to
  you; the app only needs a folder path.
- **Categories and parts stay mappable.** A real part's category reference only means
  something if both are versioned together, so both live in the same folder tree
  rather than parts being gitignored while categories live only in the app's private
  database.

### Folder layout

```
library-data/
  org/
    families.json               # Valve, Pump, Instrument, ... (loose groupings)
    categories/<id>.json        # symbol, port count, attribute schema per category
    symbols/<id>.json           # hand-drawn/uploaded symbol geometry
    parts/<categoryId>/<id>.json  # one file per real manufacturer part
  users/<name>/
    imports/
      raw/                      # manufacturer catalog PDFs you're extracting from
      extracted/                # candidate parts waiting on review (see below)
```

### Building out the library from manufacturer catalogs

The intended workflow for growing a real library is: drop catalog PDFs into
`library-data/users/<you>/imports/raw/`, run an extraction pass (an AI agent reading
the PDFs) that writes one candidate part per file into `imports/extracted/` — matching
the schema in `src/library/importStaging.ts`, including a best-guess `categoryHint`
since the agent won't know this app's internal category ids — then review and promote
each candidate into `org/parts/` (`promoteExtractedPart`) once you've confirmed the
category and skimmed the specs. This keeps the unreliable part (an AI reading a PDF
catalog) fully reviewable before anything lands in the shared library.

## Project layout

```
src/
  canvas/       scene graph, drawing tools, the schematic canvas + Zustand store
  library/      component library: db access, file-tree sync, symbol editor
  io/           PDF / BOM / project-file export and import
  ui/           toolbar, properties panel, real-hardware modal
  platform/     native menu bridge (macOS Cmd+C/V/Z/etc.)
src-tauri/      Rust shell, SQLite migrations, Tauri config/capabilities
```

## Testing

```bash
npm test
```

Unit tests cover the scene graph, canvas tools, the Zustand store (including
copy/paste and undo/redo), and library import-matching logic.
