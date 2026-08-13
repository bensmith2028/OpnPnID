import { describe, expect, it } from 'vitest';
import { resolveSymbol } from '../library/builtinSymbols';
import type { SymbolGeometry } from '../types/geometry';
import { MAX_LOCAL_EXTENT, SYMBOL_FORMAT_VERSION, SYMBOL_HALF_EXTENT, parseSymbolFile, serializeSymbol, suggestedSymbolFileName, symbolExtent } from './symbolFormat';

const META = { name: 'Automated 2-Way Valve', subtype: '2-way', actuation: 'automated' };

/** A 1x1 transparent GIF — the smallest thing that satisfies the embedded-raster check. */
const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

function imageSymbol(width = 28, height = 28): SymbolGeometry {
  return {
    points: { port0: { x: -14, y: 0 }, port1: { x: 14, y: 0 } },
    lines: [],
    arcs: [],
    ports: ['port0', 'port1'],
    image: { dataUrl: PIXEL, width, height },
  };
}

/** Rewrites one top-level field of a serialized symbol, for the damaged-file cases. */
function withField(geometry: SymbolGeometry, field: string, value: unknown): string {
  const parsed = JSON.parse(serializeSymbol(geometry, META)) as Record<string, unknown>;
  parsed[field] = value;
  return JSON.stringify(parsed);
}

describe('parseSymbolFile', () => {
  it('round-trips a vector symbol verbatim, with no rescaling', () => {
    const original = resolveSymbol('2-way', 'automated', 2);
    const { file, scale } = parseSymbolFile(serializeSymbol(original, META));

    expect(file.version).toBe(SYMBOL_FORMAT_VERSION);
    expect(file.name).toBe(META.name);
    expect(file.subtype).toBe('2-way');
    expect(file.actuation).toBe('automated');
    expect(scale).toBe(1);
    expect(file.geometry).toEqual(original);
  });

  it('round-trips an image symbol, keeping the embedded raster and its size', () => {
    const { file, scale } = parseSymbolFile(serializeSymbol(imageSymbol(20, 10), META));

    expect(scale).toBe(1);
    expect(file.geometry.image).toEqual({ dataUrl: PIXEL, width: 20, height: 10 });
    expect(file.geometry.ports).toEqual(['port0', 'port1']);
  });

  it('rescales a file authored against a different unit convention so the symbol keeps its relative size', () => {
    // The same glyph as authored by a build whose standard box is half as wide: its box is
    // ±7, so the identical drawing is written with every coordinate halved.
    const original = resolveSymbol('2-way', 'manual', 2);
    const halved: SymbolGeometry = {
      ...original,
      points: Object.fromEntries(Object.entries(original.points).map(([id, p]) => [id, { x: p.x / 2, y: p.y / 2 }])),
    };
    const { file, scale } = parseSymbolFile(withField(halved, 'halfExtent', SYMBOL_HALF_EXTENT / 2));

    expect(scale).toBe(2);
    // Back to the size it was authored at, relative to this build's built-in glyphs.
    expect(file.geometry.points).toEqual(original.points);
  });

  it('leaves arc bulges alone when rescaling, since bulge is a shape ratio not a length', () => {
    const geometry: SymbolGeometry = {
      points: { a: { x: -10, y: 0 }, b: { x: 10, y: 0 } },
      lines: [],
      arcs: [{ a: 'a', b: 'b', bulge: 0.4142 }],
      ports: ['a'],
    };
    const { file, scale } = parseSymbolFile(withField(geometry, 'halfExtent', SYMBOL_HALF_EXTENT / 2));

    expect(scale).toBe(2);
    expect(file.geometry.points.b).toEqual({ x: 20, y: 0 });
    expect(file.geometry.arcs[0].bulge).toBe(0.4142);
  });

  it('scales an oversized symbol down to what the editor can draw', () => {
    const huge: SymbolGeometry = {
      points: { a: { x: -280, y: 0 }, b: { x: 280, y: 0 } },
      lines: [['a', 'b']],
      arcs: [],
      ports: ['a', 'b'],
    };
    const { file, scale } = parseSymbolFile(serializeSymbol(huge, META));

    expect(scale).toBeCloseTo(MAX_LOCAL_EXTENT / 280);
    expect(symbolExtent(file.geometry)).toBeCloseTo(MAX_LOCAL_EXTENT);
  });

  it("counts an image body's own size when deciding a symbol is oversized", () => {
    // Ports sit well inside the drawable range; only the image itself is too big.
    const { file } = parseSymbolFile(serializeSymbol(imageSymbol(200, 200), META));

    expect(symbolExtent(file.geometry)).toBeCloseTo(MAX_LOCAL_EXTENT);
    expect(file.geometry.image!.width).toBeCloseTo(MAX_LOCAL_EXTENT * 2);
  });

  it('rejects a file whose image is a remote URL rather than embedded data', () => {
    const remote = { ...imageSymbol(), image: { dataUrl: 'https://example.com/valve.png', width: 28, height: 28 } };
    expect(() => parseSymbolFile(serializeSymbol(remote, META))).toThrow(/isn't embedded/);
  });

  it('rejects text that is not JSON', () => {
    expect(() => parseSymbolFile('<svg />')).toThrow(/valid JSON/);
  });

  it('rejects a JSON file that is not a symbol', () => {
    expect(() => parseSymbolFile(JSON.stringify({ hello: 'world' }))).toThrow(/symbol file/);
  });

  it('points a whole project file at the right command instead of calling it damaged', () => {
    expect(() => parseSymbolFile(JSON.stringify({ app: 'opnpnid', version: 2, scene: { points: [] } }))).toThrow(/whole project file/);
  });

  it('refuses a symbol from a newer schema version', () => {
    expect(() => parseSymbolFile(withField(imageSymbol(), 'version', SYMBOL_FORMAT_VERSION + 1))).toThrow(/newer version/);
  });

  it('rejects geometry referencing points it does not contain', () => {
    const dangling = { ...imageSymbol(), ports: ['port0', 'nope'] };
    expect(() => parseSymbolFile(serializeSymbol(dangling, META))).toThrow(/doesn't contain/);
  });

  it('round-trips a symbol\'s own labels', () => {
    const labelled: SymbolGeometry = {
      points: { a: { x: -10, y: 0 }, b: { x: 10, y: 0 } },
      lines: [['a', 'b']],
      arcs: [],
      ports: ['a', 'b'],
      texts: [{ x: 0, y: -6, text: 'NC', size: 4 }],
    };
    const { file, scale } = parseSymbolFile(serializeSymbol(labelled, META));

    expect(scale).toBe(1);
    expect(file.geometry.texts).toEqual([{ x: 0, y: -6, text: 'NC', size: 4 }]);
  });

  it('rescales label positions and sizes with the rest of the geometry', () => {
    const labelled: SymbolGeometry = {
      points: { a: { x: -5, y: 0 } },
      lines: [],
      arcs: [],
      ports: ['a'],
      texts: [{ x: 0, y: -3, text: 'NC', size: 2 }],
    };
    const { file, scale } = parseSymbolFile(withField(labelled, 'halfExtent', SYMBOL_HALF_EXTENT / 2));

    expect(scale).toBe(2);
    expect(file.geometry.texts).toEqual([{ x: 0, y: -6, text: 'NC', size: 4 }]);
  });

  it('imports a label at the largest size the editor allows without shrinking the symbol', () => {
    // The symbol editor caps a label at its own half-extent (MAX_TEXT_SIZE === this), and a
    // label counts towards the extent by half its height — so the biggest label a user can
    // author must still land inside the drawable range rather than triggering a fit-scale
    // that would shrink the glyph it belongs to.
    const shouted: SymbolGeometry = {
      points: { a: { x: -10, y: 0 }, b: { x: 10, y: 0 } },
      lines: [['a', 'b']],
      arcs: [],
      ports: ['a', 'b'],
      texts: [{ x: 0, y: 0, text: 'PSV', size: MAX_LOCAL_EXTENT }],
    };
    const { file, scale } = parseSymbolFile(serializeSymbol(shouted, META));

    expect(scale).toBe(1);
    expect(file.geometry.texts).toEqual(shouted.texts);
  });

  it('imports a version 1 symbol, which predates labels, as one with none', () => {
    const { file } = parseSymbolFile(withField(imageSymbol(), 'version', 1));
    expect(file.version).toBe(1);
    expect(file.geometry.texts).toBeUndefined();
  });

  it('rejects a damaged label rather than importing a symbol missing part of its lettering', () => {
    const broken = { ...imageSymbol(), texts: [{ x: 0, y: 0, text: 'NC' }] as unknown as SymbolGeometry['texts'] };
    expect(() => parseSymbolFile(serializeSymbol(broken, META))).toThrow(/damaged/);
  });

  it('assumes this build\'s units when a file declares no halfExtent', () => {
    const { scale } = parseSymbolFile(withField(imageSymbol(), 'halfExtent', undefined));
    expect(scale).toBe(1);
  });
});

describe('suggestedSymbolFileName', () => {
  it('slugifies the category name', () => {
    expect(suggestedSymbolFileName('Automated 2-Way Valve')).toBe('automated-2-way-valve.pnidsym.json');
  });

  it('falls back when a name has nothing to slugify', () => {
    expect(suggestedSymbolFileName('///')).toBe('symbol.pnidsym.json');
  });
});
