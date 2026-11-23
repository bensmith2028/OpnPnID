# OpnPnID

A P&ID (piping & instrumentation diagram) editor that is **a single HTML file**. Double-click
`OpnPnID.html` and it opens in your browser — no install, no account, no server, no internet,
nothing to host or keep running. Keep the file and it works indefinitely.

Draw schematics on a snapping canvas from a library of components, record the specific hardware
each one is, and export to PDF or a parts list.

## Using it

Open `OpnPnID.html` in Chrome, Edge, Firefox or Safari.

1. Open a family in the **Library** (right) and click a component, then click the canvas to place it.
2. Draw pipes with the **Line** and **Arc** tools; they snap to component ports.
3. Click anything to see its **properties** in a popup: tag, name, rotation (**R** turns a component
   45°), line weight, and its **hardware** (name and free-text notes — hover a component to see them).
4. **File ▸ Save As…** keeps the drawing as a `.pnid.json` file; **File ▸ Open…** loads one back.
   Export a PDF or a parts list (every component, or counts) from the same menu.

The empty canvas shows a **Controls** tab listing every keyboard and mouse shortcut.

## Components and the hardware catalog

A component is a name, a drawing, and numbered connection ports. The pencil on each Library row
opens its edit view: redraw it, rename it, move it to another family, or delete it.

- **Hardware catalog** — the **Catalog** button in the top bar lists every saved piece of hardware
  (a name plus notes such as "Viton seals, 24 VDC"), where each can be edited or deleted.
- **Sharing** — **File ▸ Export all components…** saves your components, with their hardware, to a
  `.pnidlib.json` file; **File ▸ Import components…** adds someone else's. Importing only ever adds:
  nothing you already have is replaced, and a name clash arrives as "Name (2)".

The library lives in the browser's own storage, not in the HTML file, so clearing site data (or, in
some browsers, opening the file from another folder or browser) brings back the default library.
**Export all components now and then** as your backup. Drawings are never stored in the browser —
save them as files; the page warns you before you close it with unsaved work.

## Rebuilding the file

`OpnPnID.html` is a prebuilt copy. After changing the code:

```bash
npm install
npm run build                      # produces dist/index.html
cp dist/index.html OpnPnID.html    # refresh the prebuilt copy
```

`npm run dev` runs a development server with hot reload. Built with React, TypeScript, Zustand and
Vite; `vite-plugin-singlefile` inlines everything into the one HTML file.

```
src/
  canvas/    scene graph, drawing tools, canvas, store
  library/   component library (in-browser storage), symbol editor, hardware catalog
  io/        PDF, parts list, drawing, symbol and library files
  ui/        top bar, properties, dialogs
```
