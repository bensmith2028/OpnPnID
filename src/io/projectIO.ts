/**
 * Getting the project document (see projectFormat.ts for the format) to and from a file.
 *
 * Two runtimes, one document: inside the Tauri shell these go through the native save/open
 * dialogs and the filesystem plugin, and in a plain browser tab — where neither exists —
 * the same text is exported as a download and imported through a file picker. The bytes
 * are identical either way, so a drawing exported from one instance of the app opens in
 * any other, on any machine, with or without the same component library installed.
 */
import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { useSketchStore } from '../canvas/store/useSketchStore';
import { isTauriRuntime } from '../platform/runtime';
import type { ProjectFile } from '../types/geometry';
import { downloadText, pickFile } from './fileTransfer';
import { DEFAULT_PROJECT_FILENAME, PROJECT_FILE_EXTENSION, parseProjectFile, serializeProject } from './projectFormat';

const FILTERS = [{ name: `OpnPnID Project (*.${PROJECT_FILE_EXTENSION})`, extensions: ['json'] }];
/** The browser file picker's equivalent of FILTERS — `.pnid.json` files are `.json` files,
 * and the format's own validation is what actually decides whether a pick is usable. */
const ACCEPT = '.json,application/json';

function serializeCurrentProject(): string {
  const { graph, componentScale } = useSketchStore.getState();
  return serializeProject(graph.toJSON(), componentScale);
}

/** The name to offer when asking where to put the document: the current file's, or a
 * default for a project that's never been saved. */
function suggestedFileName(): string {
  const filePath = useSketchStore.getState().filePath;
  return filePath?.split(/[\\/]/).pop() || DEFAULT_PROJECT_FILENAME;
}

/** Writes the current document out, returning where it landed (null if the user backed
 * out). A `path` writes straight there (native Save); null asks for a destination — a
 * native Save dialog, or a download in the browser. */
async function writeProject(path: string | null): Promise<string | null> {
  const text = serializeCurrentProject();
  const name = suggestedFileName();
  if (!isTauriRuntime()) {
    downloadText(name, text);
    return name;
  }
  const target = path ?? (await save({ filters: FILTERS, defaultPath: name }));
  if (!target) return null;
  await writeTextFile(target, text);
  return target;
}

/** Loads a validated document into the store, replacing whatever's currently on the
 * canvas. The component scale is applied *first* because setComponentScale re-lays-out the
 * (still outgoing) scene and pushes a history entry — loadProject is what then swaps in the
 * new scene and clears history and the dirty flag. */
function applyProject(file: ProjectFile, path: string | null): void {
  const store = useSketchStore.getState();
  if (file.componentScale !== undefined) store.setComponentScale(file.componentScale);
  store.loadProject(file.scene);
  store.setFilePath(path);
  store.markSaved();
}

async function writeAndRecord(path: string | null): Promise<void> {
  const written = await writeProject(path);
  if (!written) return;
  useSketchStore.getState().setFilePath(written);
  useSketchStore.getState().markSaved();
}

export async function saveProjectAs(): Promise<void> {
  await writeAndRecord(null);
}

export async function saveProject(): Promise<void> {
  const filePath = useSketchStore.getState().filePath;
  // Only the native runtime can write back to a path in place; a browser download always
  // goes through the download manager, so there Save behaves like Save As.
  if (!filePath || !isTauriRuntime()) return saveProjectAs();
  await writeAndRecord(filePath);
}

/** Opens a project file, replacing the current drawing. Throws (for the caller to surface)
 * if the pick isn't a readable OpnPnID document — see parseProjectFile. */
export async function openProject(): Promise<void> {
  if (!isTauriRuntime()) {
    const file = await pickFile(ACCEPT);
    if (!file) return;
    applyProject(parseProjectFile(await file.text()), file.name);
    return;
  }
  const selected = await open({ multiple: false, filters: FILTERS });
  if (!selected || Array.isArray(selected)) return;
  applyProject(parseProjectFile(await readTextFile(selected)), selected);
}

export function newProject(): void {
  useSketchStore.getState().newProject();
}
