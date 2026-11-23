import { beforeEach, describe, expect, it } from 'vitest';
import { generatePlaceholderSymbol } from '../library/builtinSymbols';
import { parseProjectFile, serializeProject } from '../io/projectFormat';
import { SceneGraph } from './sceneGraph';
import { useSketchStore } from './store/useSketchStore';

function place() {
  useSketchStore.getState().placeComponent({ categoryId: 'c', position: { x: 0, y: 0 }, tag: 'V-1', snapshot: { familyName: 'F', categoryName: 'C', symbol: generatePlaceholderSymbol(2) } });
  return [...useSketchStore.getState().graph.components.values()][0];
}

describe('component hardware', () => {
  beforeEach(() => useSketchStore.getState().newProject());

  it('is set, trimmed of empties, and cleared', () => {
    const g = new SceneGraph();
    const c = g.addComponent({ categoryId: 'c', tag: 'V-1', position: { x: 0, y: 0 }, rotation: 0, snapshot: { familyName: 'F', categoryName: 'C', symbol: generatePlaceholderSymbol(2) } });
    g.setComponentHardware(c.id, { name: ' Burkert 2076 ', notes: 'Viton seals' });
    expect(g.components.get(c.id)!.hardware).toEqual({ name: 'Burkert 2076', notes: 'Viton seals' });
    g.setComponentHardware(c.id, { name: '', notes: '  ' });
    expect('hardware' in g.components.get(c.id)!).toBe(false);
  });

  it('can be notes only, without a name', () => {
    const g = new SceneGraph();
    const c = g.addComponent({ categoryId: 'c', tag: 'V-1', position: { x: 0, y: 0 }, rotation: 0, snapshot: { familyName: 'F', categoryName: 'C', symbol: generatePlaceholderSymbol(2) } });
    g.setComponentHardware(c.id, { name: '', notes: 'must be PTFE' });
    expect(g.components.get(c.id)!.hardware).toEqual({ name: '', notes: 'must be PTFE' });
  });

  it('is one undo step through the store', () => {
    const c = place();
    useSketchStore.getState().setComponentHardware(c.id, { name: 'Burkert 2076', notes: 'Viton' });
    expect(useSketchStore.getState().graph.components.get(c.id)!.hardware?.name).toBe('Burkert 2076');
    useSketchStore.getState().undo();
    expect(useSketchStore.getState().graph.components.get(c.id)!.hardware).toBeUndefined();
  });

  it('survives copy/paste as an independent copy', () => {
    const c = place();
    useSketchStore.getState().setComponentHardware(c.id, { name: 'Burkert 2076', notes: 'Viton' });
    useSketchStore.setState((s) => ({ selection: { ...s.selection, componentIds: new Set([c.id]) } }));
    useSketchStore.getState().copySelection();
    useSketchStore.getState().pasteSelection();
    const all = [...useSketchStore.getState().graph.components.values()];
    expect(all).toHaveLength(2);
    const pasted = all.find((x) => x.id !== c.id)!;
    expect(pasted.hardware).toEqual({ name: 'Burkert 2076', notes: 'Viton' });
    expect(pasted.hardware).not.toBe(c.hardware);
  });

  it('is saved in, and read back from, a drawing file', () => {
    const c = place();
    useSketchStore.getState().setComponentHardware(c.id, { name: 'Burkert 2076', notes: 'Viton seals\n24 VDC' });
    const file = parseProjectFile(serializeProject(useSketchStore.getState().graph.toJSON(), 1));
    expect(file.scene.components[0].hardware).toEqual({ name: 'Burkert 2076', notes: 'Viton seals\n24 VDC' });
    expect(SceneGraph.fromJSON(file.scene).components.get(c.id)!.hardware?.name).toBe('Burkert 2076');
  });
});
