import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import jsPDF from 'jspdf';
import { render } from '../canvas/renderer';
import { useSketchStore } from '../canvas/store/useSketchStore';
import { createInteractionState } from '../canvas/tools/types';
import { fitCameraToContent } from '../canvas/viewport';
import type { SceneGraph } from '../canvas/sceneGraph';
import type { Selection } from '../types/geometry';

// Roughly a landscape US-letter page at ~150dpi — doesn't need to be exact, just a
// decent fixed resolution for the offscreen render that becomes the embedded image.
const RENDER_WIDTH = 1650;
const RENDER_HEIGHT = 1275;

function emptySelection(): Selection {
  return { pointIds: new Set(), lineIds: new Set(), arcIds: new Set(), componentIds: new Set(), textIds: new Set() };
}

/**
 * Ensures a decoded `Image` exists for every unique symbol-image data URL referenced by
 * placed components, *before* the real render call. `render()` itself decodes
 * symbol images lazily (see renderer.ts's `decodedSymbolImage`) and asks for another
 * animation frame once decoding finishes — fine for the live canvas, but this is a
 * one-shot export with no animation loop to retry on. Pre-decoding via our own `Image`
 * instances warms the browser's image cache keyed by URL, so by the time the real
 * render() call lazily creates *its* Image for the same data URL, the resource is
 * already available and `img.complete` reads true instead of the export silently
 * omitting an uploaded-image symbol due to the decode race.
 */
async function preDecodeSymbolImages(graph: SceneGraph): Promise<void> {
  const dataUrls = new Set<string>();
  for (const instance of graph.components.values()) {
    const dataUrl = instance.snapshot.symbol.image?.dataUrl;
    if (dataUrl) dataUrls.add(dataUrl);
  }
  await Promise.all(
    [...dataUrls].map(
      (dataUrl) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => resolve();
          img.onerror = () => resolve(); // don't let one bad image block the whole export
          img.src = dataUrl;
        }),
    ),
  );
}

/** Renders the current scene onto an offscreen canvas at export resolution, fit to
 * frame all content, always in light theme (see the comment above LIGHT_PALETTE in
 * renderer.ts — print/PDF output must not depend on the app's current UI theme). */
async function renderSceneToCanvas(): Promise<HTMLCanvasElement> {
  const state = useSketchStore.getState();
  const { graph, componentScale, gridSize } = state;

  await preDecodeSymbolImages(graph);

  const size = { width: RENDER_WIDTH, height: RENDER_HEIGHT };
  const dpr = window.devicePixelRatio || 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(size.width * dpr);
  canvas.height = Math.round(size.height * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create a 2D canvas context for PDF export');

  const camera = fitCameraToContent(graph, size, componentScale);

  render({
    ctx,
    size,
    camera,
    graph,
    selection: emptySelection(),
    gridSize,
    gridVisible: false,
    interaction: createInteractionState(),
    theme: 'light',
    componentScale,
    requestRedraw: undefined,
  });

  return canvas;
}

/** Exports the current schematic as a single-page landscape-letter PDF: the rendered
 * scene fills the page within a small margin, with a title block (file name + export
 * date) drawn via jsPDF's own text methods so it stays crisp text, not baked into the
 * raster image. */
export async function exportPdf(): Promise<void> {
  const filePath = useSketchStore.getState().filePath;
  const projectName = filePath ? (filePath.split(/[\\/]/).pop() ?? 'Untitled') : 'Untitled';

  const canvas = await renderSceneToCanvas();
  const imageData = canvas.toDataURL('image/png');

  const doc = new jsPDF({ orientation: 'landscape', unit: 'in', format: 'letter' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const margin = 0.5;
  const titleBlockHeight = 0.35;
  const imageWidth = pageWidth - margin * 2;
  const imageHeight = pageHeight - margin * 2 - titleBlockHeight;
  doc.addImage(imageData, 'PNG', margin, margin, imageWidth, imageHeight);

  const exportDate = new Date().toLocaleDateString();
  doc.setFontSize(9);
  doc.text(projectName, margin, pageHeight - margin + 0.2);
  doc.text(`Exported ${exportDate}`, pageWidth - margin, pageHeight - margin + 0.2, { align: 'right' });

  const path = await save({ filters: [{ name: 'PDF', extensions: ['pdf'] }], defaultPath: `${projectName.replace(/\.pnid\.json$/, '')}.pdf` });
  if (!path) return;

  const bytes = new Uint8Array(doc.output('arraybuffer'));
  await writeFile(path, bytes);
}
