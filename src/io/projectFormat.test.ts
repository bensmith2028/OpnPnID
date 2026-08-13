import { describe, expect, it } from 'vitest';
import { generatePlaceholderSymbol } from '../library/builtinSymbols';
import { SceneGraph } from '../canvas/sceneGraph';
import type { ComponentSnapshot } from '../types/geometry';
import { PROJECT_FORMAT_VERSION, parseProjectFile, serializeProject } from './projectFormat';

function sampleSnapshot(portCount = 2): ComponentSnapshot {
  return { familyName: 'Valve', categoryName: 'Test Valve', symbol: generatePlaceholderSymbol(portCount), realPart: null };
}

/** A small but complete drawing: a pipe, an arc, and a component with a pipe on one port. */
function sampleGraph(): SceneGraph {
  const g = new SceneGraph();
  const a = g.addPoint(0, 0);
  const b = g.addPoint(10, 0);
  const c = g.addPoint(10, 10);
  g.addLine(a.id, b.id, 'H');
  g.addArc(b.id, c.id, 0.5);
  const component = g.addComponent({
    categoryId: 'cat',
    realPartId: null,
    tag: 'V-101',
    position: { x: 40, y: 40 },
    rotation: Math.PI / 2,
    snapshot: sampleSnapshot(),
  });
  g.addLine(c.id, component.connections[0].pointId);
  g.addText(20, -10, 'Feed header', 12);
  return g;
}

describe('parseProjectFile', () => {
  it('round-trips a drawing through serialize/parse, preserving connectivity', () => {
    const original = sampleGraph();
    const file = parseProjectFile(serializeProject(original.toJSON(), 1.5));
    const restored = SceneGraph.fromJSON(file.scene);

    expect(file.version).toBe(PROJECT_FORMAT_VERSION);
    expect(file.componentScale).toBe(1.5);
    expect(restored.toJSON()).toEqual(original.toJSON());
    // The port that had a pipe attached is still the shared vertex it was before.
    const component = [...restored.components.values()][0];
    expect(restored.linesOfPoint(component.connections[0].pointId)).toHaveLength(1);
    expect(restored.componentOwning(component.connections[0].pointId)).toBe(component.id);
  });

  it('carries fields it knows nothing about through a round trip', () => {
    const g = sampleGraph();
    const component = [...g.components.values()][0];
    (component as unknown as Record<string, unknown>).somethingAddedLater = 'keep me';
    const restored = parseProjectFile(serializeProject(g.toJSON(), 1)).scene.components[0];
    expect((restored as unknown as Record<string, unknown>).somethingAddedLater).toBe('keep me');
  });

  it('reads a version 1 file, leaving the component scale unspecified', () => {
    const v1 = JSON.stringify({ version: 1, scene: sampleGraph().toJSON() });
    const file = parseProjectFile(v1);
    expect(file.version).toBe(1);
    expect(file.componentScale).toBeUndefined();
    expect(file.scene.components).toHaveLength(1);
  });

  it('rejects text that is not JSON', () => {
    expect(() => parseProjectFile('%PDF-1.4 not json at all')).toThrow(/valid JSON/);
  });

  it('rejects JSON that is not a project file', () => {
    expect(() => parseProjectFile(JSON.stringify({ name: 'opnpnid', version: '0.1.0' }))).toThrow(/OpnPnID project file/);
    expect(() => parseProjectFile(JSON.stringify([1, 2, 3]))).toThrow(/OpnPnID project file/);
    expect(() => parseProjectFile(JSON.stringify({ version: 1 }))).toThrow(/OpnPnID project file/);
  });

  it('refuses a file written by a newer schema version instead of half-loading it', () => {
    const future = JSON.stringify({ app: 'opnpnid', version: PROJECT_FORMAT_VERSION + 1, scene: sampleGraph().toJSON() });
    expect(() => parseProjectFile(future)).toThrow(/newer version of OpnPnID/);
  });

  it('rejects a damaged scene rather than replacing the drawing with a broken one', () => {
    const scene = sampleGraph().toJSON();
    expect(() => parseProjectFile(JSON.stringify({ version: PROJECT_FORMAT_VERSION, scene: { lines: [] } }))).toThrow(/damaged/);
    expect(() =>
      parseProjectFile(JSON.stringify({ version: PROJECT_FORMAT_VERSION, scene: { ...scene, points: [{ id: 'pt_1', x: 0 }] } })),
    ).toThrow(/damaged/);
    expect(() =>
      parseProjectFile(JSON.stringify({ version: PROJECT_FORMAT_VERSION, scene: { ...scene, lines: [{ id: 'ln_1', startId: 'nope', endId: 'nah' }] } })),
    ).toThrow(/damaged/);
  });

  it('accepts a scene with no arcs, components or texts', () => {
    const file = parseProjectFile(JSON.stringify({ version: PROJECT_FORMAT_VERSION, scene: { points: [], lines: [] } }));
    expect(file.scene.arcs).toEqual([]);
    expect(file.scene.components).toEqual([]);
    expect(file.scene.texts).toEqual([]);
  });

  it('round-trips text annotations', () => {
    const file = parseProjectFile(serializeProject(sampleGraph().toJSON(), 1));
    expect(file.scene.texts).toEqual([{ id: expect.any(String), x: 20, y: -10, text: 'Feed header', fontSize: 12 }]);
  });

  it('reads a version 2 file, whose scene predates text annotations', () => {
    const scene = sampleGraph().toJSON();
    const v2 = JSON.stringify({ app: 'opnpnid', version: 2, componentScale: 1, scene: { ...scene, texts: undefined } });
    const file = parseProjectFile(v2);
    expect(file.version).toBe(2);
    expect(file.scene.texts).toEqual([]);
  });

  it('rejects a damaged text annotation rather than half-loading the drawing', () => {
    const scene = sampleGraph().toJSON();
    expect(() =>
      parseProjectFile(JSON.stringify({ version: PROJECT_FORMAT_VERSION, scene: { ...scene, texts: [{ id: 'txt_1', x: 0, y: 0 }] } })),
    ).toThrow(/damaged/);
  });
});
