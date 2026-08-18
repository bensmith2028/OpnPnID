# OpnPnID

A desktop P&ID (piping & instrumentation diagram) editor, built with Tauri + React +
TypeScript. Draw schematics on a snapping canvas, place components from your own parts
library, and export to PDF or a bill of materials.

## Features

- **Drawing** — points, lines, arcs, circles and text notes on a snapping grid, with
  select/drag, undo/redo and copy/paste.
- **Component library** — **Family** (Valve, Pump, …) → **Category** (Automated 2-Way
  Valve — owns the symbol and its own attribute schema) → **Real Part** (a specific
  manufacturer model, with specs, datasheet link and price).
- **Symbol editor** — draw a category's symbol by hand or upload an image, then mark
  where pipes connect.
- **Export** — PDF, bill-of-materials CSV, portable `.pnid.json` drawings and
  `.pnidsym.json` symbols.

## Requirements

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/tools/install) (stable) — builds the Tauri shell
- [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your platform
  (Xcode Command Line Tools on macOS, etc.)

## Getting started

```bash
npm install
npm run tauri dev     # run the app with hot reload
npm test              # run the test suite
npm run tauri build   # produce a native installer
```

On first launch the app creates a local `library.db` SQLite file in your OS app-data
folder, seeded with the default library built into the app (families, categories, and
hand-drawn symbols). **It works with no
further setup.** Everything below is about growing that library into a real one.

---

# Building the parts library

This is the main thing you'll spend time on: turning a handful of starter symbols into a
library of real, orderable parts. It has three stages — connect a folder, scrape catalogs
into candidates, then review candidates into the library.

## 1. Connect a library folder

By default your library lives only in the local database on one machine. Connecting a
folder makes it a set of plain JSON files instead, so it can be shared, backed up and
version-controlled.

1. Open the **Component Library** panel.
2. Click **Connect Library Folder…**.
3. Pick or create a folder. A `library-data/` folder inside this repo works out of the
   box — it's already git-ignored. It can live anywhere: a shared drive, a synced cloud
   folder, or your own private repo.

From then on every library edit is written to **both** the local database (fast to read)
**and** the folder (the real source of truth). Click **Sync Now** to re-read the folder
after someone else changes it.

**Why a folder?** JSON files diff and merge in git, so you can see exactly what changed
and two people rarely conflict. And real part data — which may be large, scraped, or
licensed — stays out of this codebase entirely.

### Folder layout

```
library-data/
  org/
    families.json                 # Valve, Pump, Instrument, ...
    categories/<id>.json          # symbol, port count, attribute schema
    symbols/<id>.json             # drawn or uploaded symbol geometry
    parts/<categoryId>/<id>.json  # one file per real part
  users/<name>/
    imports/
      raw/                        # catalog PDFs you want to pull parts out of
      extracted/                  # candidate parts waiting for your review
```

## 2. Scrape a manufacturer catalog

The idea is simple: **an AI agent reads catalog PDFs and writes one JSON file per part it
finds. You then review them.** Nothing an agent writes goes into your library until you
say so.

**Step 1.** Drop catalog PDFs into `library-data/users/<you>/imports/raw/`.

**Step 2.** Point an AI agent at that folder and ask it to write one JSON file per part
into `imports/extracted/`. Each file looks like this:

```json
{
  "manufacturer": "Swagelok",
  "modelNumber": "SS-43GS4",
  "categoryHint": { "family": "Valve", "subtype": "3-way", "actuation": "manual", "portCount": 3 },
  "description": "3-way ball valve, 1/4 in. Swagelok tube fitting",
  "datasheetUrl": "https://...",
  "price": 189.5,
  "currency": "USD",
  "specs": { "cv": 1.2, "maxPressure": "3000 psi", "body": "316 SS" },
  "sourceFile": "swagelok-ball-valves.pdf",
  "sourcePage": 14,
  "confidence": 0.82
}
```

Only `manufacturer`, `modelNumber` and `categoryHint.family` are required. Everything
else is optional — put in whatever the catalog actually gives you.

**Why `categoryHint` instead of a category?** The agent has no idea what the internal
category IDs in your library are. So it just describes the part in plain terms, and the
app matches that description against your real categories and suggests the best fit. You
confirm or correct it. The exact schema lives in `src/library/importStaging.ts`.

**Step 3.** Anything the agent is unsure about, it should still write out — with a low
`confidence`. It's much easier to reject a bad candidate than to notice a missing one.

## 3. Review candidates into the library

Extraction quality varies a lot depending on how the manufacturer lays out their catalog,
so **nothing is promoted automatically**. For each candidate: check the category it was
matched to, skim the specs against the datasheet, then promote it. Promoting writes a real
part into `org/parts/` and syncs it; rejecting deletes the candidate file.

There's no review screen in the app yet — for now this is done by hand, with
`promoteExtractedPart` / `rejectExtractedPart` in `src/library/importStaging.ts` doing the
actual work.

---

## File formats

Both formats are plain, diffable JSON with a schema `version` field. Older versions are
read; anything newer is refused with a clear message rather than half-loaded. Bad or
damaged files are reported and leave your current work untouched.

**Drawings (`.pnid.json`)** — **Save As** writes one, **Open** reads it back. A drawing
carries a full snapshot of every component it uses, so it opens correctly on a machine
whose library is different or missing entirely. Defined in `src/io/projectFormat.ts`.

**Symbols (`.pnidsym.json`)** — one category's part drawing, exported and imported from
the symbol editor's footer. Vector and uploaded-image symbols use the same format; an
image travels embedded, so the file is self-contained. The file records the unit box it
was drawn against, so an imported symbol arrives at the right size relative to the
built-in symbols rather than over- or undersized. Defined in `src/io/symbolFormat.ts`.

Both work in the desktop app (native dialogs) and in a browser tab via `npm run dev`
(download + file picker).

## Project layout

```
src/
  canvas/     scene graph, drawing tools, canvas + Zustand store
  library/    component library: database, folder sync, symbol editor
  io/         PDF / BOM / drawing / symbol export and import
  ui/         toolbar, properties panel, modals
  platform/   native menu bridge
src-tauri/    Rust shell, SQLite migrations, Tauri config
```

Tests cover the scene graph, canvas tools, snapping, the store (copy/paste, undo/redo),
both file formats and the catalog import-matching logic.
