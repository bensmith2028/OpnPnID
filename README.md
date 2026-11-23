# OpnPnID

A P&ID (piping & instrumentation diagram) editor that is **a single HTML file**. Double-click
it and it opens in your browser — no install, no account, no server, no internet, nothing
to host or keep running. Keep the file and it works indefinitely. Draw schematics on a
snapping canvas from a library of general components, then export to PDF or a
bill-of-materials CSV.

## Using it

Open `OpnPnID.html` (it's in this repo, prebuilt) in Chrome, Edge, Firefox or Safari and
start drawing. The library comes pre-loaded with valves, pumps and instruments.

1. Click **Library**, pick a component, and click the canvas to place it. Click again to
   place more.
2. Draw pipes with the **Line** and **Arc** tools; they snap to component ports.
3. **Save** downloads your drawing as a `.pnid.json` file; **Open** loads one back.
   **Export PDF** and **Export BOM** download those too.

Your library is stored in your browser, so it's there next time. Drawings are *not* — save
them as files, and the page will warn you before you close it with unsaved work. A drawing carries a copy of every component it uses,
so it opens correctly anywhere, even with a different library.

## Components and sharing

A component is a name, a drawing, and the points where pipes connect. In the Library
panel:

- **Edit** reveals rename, **✎ Edit Drawing** (draw a symbol or upload an image, then mark
  its connection ports), **⤓ Export** and delete.
- **Export All** saves your whole library; **⤓** on a row saves just that component. Both
  write a `.pnidlib.json` file.
- **Import…** adds the components from someone else's file. **It never replaces anything
  you have:** components you already have are skipped, and one that shares a name with a
  different drawing arrives as "Name (2)".
- **Reset** (in Edit mode) goes back to the built-in default library.

The library lives in the browser's own storage, not in the file. Clearing site data — or, in
some browsers, opening the HTML file from a different folder or browser — starts you on the
default library again. So **Export All now and then** as your backup; it's a file you keep,
and Import puts it back.

## Rebuilding the file

`OpnPnID.html` in the repo root is a prebuilt copy. If you change the code, rebuild it:

```bash
npm install
npm run build                      # produces dist/index.html
cp dist/index.html OpnPnID.html    # refresh the prebuilt copy
```

That one file is the whole app: put it anywhere or hand it to someone. It has no
dependencies on this repo, a network, or any server. You only need Node to *build* it or
to work on the code:

```bash
npm run dev      # development server with hot reload
npm test
```

Built with React, TypeScript, Zustand and Vite; `vite-plugin-singlefile` inlines everything
into the one HTML file.

```
src/
  canvas/     scene graph, drawing tools, canvas + Zustand store
  library/    component library (in-browser store), symbol editor, default library
  io/         PDF / BOM / drawing / symbol / library files
  ui/         toolbar, properties panel, dialogs
```

File formats (`src/io/`): drawings `.pnid.json`, single symbols `.pnidsym.json`, libraries
and shared components `.pnidlib.json`. All are plain JSON with a schema `version`; newer
versions are refused with a clear message rather than half-loaded.

The default library is `src/library/defaultLibrary.json`.
