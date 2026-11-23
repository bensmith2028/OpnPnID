/**
 * Getting the project document (see projectFormat.ts for the format) to and from a file:
 * saving is a download, opening is a file picker. A drawing carries a snapshot of every
 * component it uses, so it opens in any other copy of the app, with or without the same
 * component library.
 */
import { useSketchStore } from '../canvas/store/useSketchStore';
import type { ProjectFile } from '../types/geometry';
import { downloadText, pickFile } from './fileTransfer';
import { DEFAULT_PROJECT_FILENAME, parseProjectFile, serializeProject } from './projectFormat';

/** The file picker's filter — `.pnid.json` files are `.json` files, and the format's own
 * validation is what actually decides whether a pick is usable. */
const ACCEPT = '.json,application/json';

function serializeCurrentProject(): string {
  const { graph, componentScale } = useSketchStore.getState();
  return serializeProject(graph.toJSON(), componentScale);
}

/** The name to save under: the current file's, or a default for a project never saved. */
function suggestedFileName(): string {
  const filePath = useSketchStore.getState().filePath;
  return filePath?.split(/[\\/]/).pop() || DEFAULT_PROJECT_FILENAME;
}

/** Loads a validated document into the store, replacing whatever's currently on the
 * canvas. The component scale is applied *first* because setComponentScale re-lays-out the
 * (still outgoing) scene and pushes a history entry — loadProject is what then swaps in the
 * new scene and clears history and the dirty flag. */
function applyProject(file: ProjectFile, name: string): void {
  const store = useSketchStore.getState();
  if (file.componentScale !== undefined) store.setComponentScale(file.componentScale);
  store.loadProject(file.scene);
  store.setFilePath(name);
  store.markSaved();
}

/** Downloads the current drawing as a project file. A browser can't write back to a path it
 * opened from, so Save and Save As are the same action: a fresh download. */
export async function saveProjectAs(): Promise<void> {
  const name = suggestedFileName();
  downloadText(name, serializeCurrentProject());
  useSketchStore.getState().setFilePath(name);
  useSketchStore.getState().markSaved();
}

export const saveProject = saveProjectAs;

/** Opens a project file, replacing the current drawing. Throws (for the caller to surface)
 * if the pick isn't a readable OpnPnID document — see parseProjectFile. */
export async function openProject(): Promise<void> {
  const file = await pickFile(ACCEPT);
  if (!file) return;
  applyProject(parseProjectFile(await file.text()), file.name);
}

export function newProject(): void {
  useSketchStore.getState().newProject();
}
