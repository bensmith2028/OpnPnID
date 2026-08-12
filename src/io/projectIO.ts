import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { useSketchStore } from '../canvas/store/useSketchStore';
import type { ProjectFile, SceneGraphJSON } from '../types/geometry';

const FILTERS = [{ name: 'OpnPnID Project (*.pnid.json)', extensions: ['json'] }];

async function writeToPath(path: string): Promise<void> {
  const scene: SceneGraphJSON = useSketchStore.getState().graph.toJSON();
  const file: ProjectFile = { version: 1, scene };
  await writeTextFile(path, JSON.stringify(file, null, 2));
  useSketchStore.getState().setFilePath(path);
  useSketchStore.getState().markSaved();
}

export async function saveProjectAs(): Promise<void> {
  const path = await save({ filters: FILTERS, defaultPath: 'untitled.pnid.json' });
  if (!path) return;
  await writeToPath(path);
}

export async function saveProject(): Promise<void> {
  const filePath = useSketchStore.getState().filePath;
  if (!filePath) return saveProjectAs();
  await writeToPath(filePath);
}

export async function openProject(): Promise<void> {
  const selected = await open({ multiple: false, filters: FILTERS });
  if (!selected || Array.isArray(selected)) return;
  const contents = await readTextFile(selected);
  const file = JSON.parse(contents) as ProjectFile;
  useSketchStore.getState().loadProject(file.scene);
  useSketchStore.getState().setFilePath(selected);
  useSketchStore.getState().markSaved();
}

export function newProject(): void {
  useSketchStore.getState().newProject();
}
