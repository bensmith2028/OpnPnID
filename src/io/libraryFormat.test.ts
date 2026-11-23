import { describe, expect, it } from 'vitest';
import type { Category, LibraryData } from '../library/db';
import { effectiveSymbol } from '../library/db';
import type { SymbolGeometry } from '../types/geometry';
import { mergeLibrary, parseLibraryFile, serializeLibrary } from './libraryFormat';
import { serializeSymbol } from './symbolFormat';

const lineSymbol = (x: number): SymbolGeometry => ({
  points: { a: { x: -x, y: 0 }, b: { x, y: 0 } },
  lines: [['a', 'b']],
  arcs: [],
  ports: ['a', 'b'],
});

function category(over: Partial<Category> & { id: string }): Category {
  return { familyId: 'fam1', name: 'Thing', subtype: null, actuation: null, portCount: 2, symbolId: null, ...over };
}

function library(): LibraryData {
  return {
    families: [{ id: 'fam1', name: 'Valve', tagLetter: 'V', sortOrder: 0 }],
    categories: [category({ id: 'c1', name: 'Check Valve', symbolId: 's1' })],
    symbols: [{ id: 's1', geometry: lineSymbol(10) }],
  };
}

let n = 0;
const deps = { newId: (p: string) => `${p}_${++n}`, effectiveSymbol };

const exportable = (name: string, geometry: SymbolGeometry, family = 'Valve') => ({
  family: { id: 'x', name: family, tagLetter: 'V', sortOrder: 0 },
  category: category({ id: 'x', name }),
  geometry,
});

describe('library file round trip', () => {
  it('writes components that parse back identically', () => {
    const file = parseLibraryFile(serializeLibrary([exportable('Check Valve', lineSymbol(10))]));
    expect(file.components).toHaveLength(1);
    expect(file.components[0]).toMatchObject({ name: 'Check Valve', family: { name: 'Valve', tagLetter: 'V' }, portCount: 2 });
    expect(file.components[0].geometry).toEqual(lineSymbol(10));
  });

  it('reads a bare symbol file as a one-component library', () => {
    const text = serializeSymbol(lineSymbol(8), { name: 'Odd Valve', subtype: null, actuation: null });
    const file = parseLibraryFile(text);
    expect(file.components[0]).toMatchObject({ name: 'Odd Valve', family: { name: 'Imported' }, portCount: 2 });
  });

  it('rejects things that are not library files, with a readable reason', () => {
    expect(() => parseLibraryFile('not json')).toThrow(/valid JSON/);
    expect(() => parseLibraryFile('{"hello":1}')).toThrow(/OpnPnID library/);
    expect(() => parseLibraryFile('{"scene":{}}')).toThrow(/whole drawing/);
    expect(() => parseLibraryFile('{"app":"opnpnid-library","version":99,"components":[]}')).toThrow(/newer version/);
    expect(() => parseLibraryFile('{"app":"opnpnid-library","version":1,"components":[{"name":"x"}]}')).toThrow(/no drawing/);
  });
});

describe('mergeLibrary', () => {
  const incoming = (...c: ReturnType<typeof exportable>[]) => parseLibraryFile(serializeLibrary(c));

  it('adds new components and reuses a family that already exists', () => {
    const before = library();
    const { data, summary } = mergeLibrary(before, incoming(exportable('Needle Valve', lineSymbol(6))), deps);
    expect(summary).toEqual({ added: 1, skipped: 0, renamed: 0 });
    expect(data.families).toHaveLength(1);
    expect(data.categories.map((c) => c.name).sort()).toEqual(['Check Valve', 'Needle Valve']);
    // Input untouched.
    expect(before.categories).toHaveLength(1);
  });

  it('creates families that do not exist yet', () => {
    const { data } = mergeLibrary(library(), incoming(exportable('Scale', lineSymbol(4), 'Instrument')), deps);
    expect(data.families.map((f) => f.name)).toEqual(['Valve', 'Instrument']);
  });

  it('skips a component that is already there with the same drawing', () => {
    const { data, summary } = mergeLibrary(library(), incoming(exportable('check valve', lineSymbol(10))), deps);
    expect(summary).toEqual({ added: 0, skipped: 1, renamed: 0 });
    expect(data.categories).toHaveLength(1);
  });

  it('never overwrites: same name with a different drawing arrives renamed', () => {
    const first = mergeLibrary(library(), incoming(exportable('Check Valve', lineSymbol(5))), deps);
    expect(first.summary).toEqual({ added: 1, skipped: 0, renamed: 1 });
    expect(first.data.categories.map((c) => c.name).sort()).toEqual(['Check Valve', 'Check Valve (2)']);
    // The original is intact.
    expect(first.data.symbols.find((s) => s.id === 's1')!.geometry).toEqual(lineSymbol(10));

    const second = mergeLibrary(first.data, incoming(exportable('Check Valve', lineSymbol(3))), deps);
    expect(second.data.categories.map((c) => c.name)).toContain('Check Valve (3)');
  });

  it('is idempotent: importing the same file twice adds nothing the second time', () => {
    const file = incoming(exportable('Needle Valve', lineSymbol(6)));
    const once = mergeLibrary(library(), file, deps);
    const twice = mergeLibrary(once.data, file, deps);
    expect(twice.summary.added).toBe(0);
    expect(twice.summary.skipped).toBe(1);
  });
});
