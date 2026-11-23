import { beforeEach, describe, expect, it } from 'vitest';
import * as db from './db';

// Node has no IndexedDB, so these exercise the in-memory path — which is also what the app
// falls back to where IndexedDB is unavailable.
beforeEach(async () => {
  db.resetLibraryCacheForTests();
});

describe('default library', () => {
  it('seeds on first use with families, components and drawings', async () => {
    const families = await db.listFamilies();
    expect(families.map((f) => f.name)).toContain('Valve');
    const valves = await db.listCategories(families.find((f) => f.name === 'Valve')!.id);
    expect(valves.length).toBeGreaterThan(3);
  });

  it('builds a snapshot for every seeded component, each with a drawing and ports', async () => {
    for (const c of await db.listCategories()) {
      const snap = await db.buildComponentSnapshot(c.id);
      expect(snap, c.name).not.toBeNull();
      expect(snap!.symbol.ports.length, c.name).toBeGreaterThan(0);
      for (const p of snap!.symbol.ports) expect(snap!.symbol.points[p], `${c.name}:${p}`).toBeDefined();
    }
  });
});

describe('editing', () => {
  it('adds, renames and deletes a component along with its drawing', async () => {
    const [family] = await db.listFamilies();
    const symbol = await db.upsertSymbol({ geometry: { points: { a: { x: 0, y: 0 } }, lines: [], arcs: [], ports: ['a'] } });
    const cat = await db.upsertCategory({ familyId: family.id, name: 'Widget', symbolId: symbol.id });
    expect((await db.getCategory(cat.id))?.name).toBe('Widget');

    await db.upsertCategory({ ...cat, name: 'Gadget' });
    expect((await db.getCategory(cat.id))?.name).toBe('Gadget');

    await db.deleteCategory(cat.id);
    expect(await db.getCategory(cat.id)).toBeNull();
    expect(await db.getSymbol(symbol.id)).toBeNull();
  });

  it('deleting a family removes its components', async () => {
    const [family] = await db.listFamilies();
    expect((await db.listCategories(family.id)).length).toBeGreaterThan(0);
    await db.deleteFamily(family.id);
    expect(await db.listCategories(family.id)).toEqual([]);
  });

  it('returns copies, so callers cannot mutate the stored library by accident', async () => {
    const [family] = await db.listFamilies();
    family.name = 'Hacked';
    expect((await db.listFamilies())[0].name).not.toBe('Hacked');
  });
});

describe('sharing', () => {
  it('exports a single component and re-importing it is a no-op', async () => {
    const [cat] = await db.listCategories();
    const exported = await db.collectExportable([cat.id]);
    expect(exported).toHaveLength(1);

    const { parseLibraryFile, serializeLibrary } = await import('../io/libraryFormat');
    const summary = await db.importLibrary(parseLibraryFile(serializeLibrary(exported)));
    expect(summary).toEqual({ added: 0, hardware: 0, skipped: 1, renamed: 0 });
  });

  it("importing another person's library adds to — never replaces — yours", async () => {
    const before = await db.listCategories();
    const { parseLibraryFile, serializeLibrary } = await import('../io/libraryFormat');
    const mine = (await db.collectExportable([before[0].id]))[0];
    const theirs = { ...mine, category: { ...mine.category, name: 'Their Component' } };
    await db.importLibrary(parseLibraryFile(serializeLibrary([theirs])));
    const after = await db.listCategories();
    expect(after).toHaveLength(before.length + 1);
    for (const c of before) expect(after.some((a) => a.id === c.id && a.name === c.name)).toBe(true);
  });

  it('reset restores the default library', async () => {
    const [family] = await db.listFamilies();
    await db.deleteFamily(family.id);
    await db.resetToDefaultLibrary();
    expect((await db.listFamilies()).length).toBeGreaterThan(0);
  });
});

describe('hardware', () => {
  it('belongs to a component: add, edit, list, delete', async () => {
    const [cat] = await db.listCategories();
    expect(await db.listHardware(cat.id)).toEqual([]);
    const item = await db.upsertHardware({ categoryId: cat.id, name: 'Burkert 2076', notes: 'Viton seals' });
    await db.upsertHardware({ ...item, notes: 'Viton seals, 24 VDC' });
    expect((await db.listHardware(cat.id)).map((h) => [h.name, h.notes])).toEqual([['Burkert 2076', 'Viton seals, 24 VDC']]);
    await db.deleteHardware(item.id);
    expect(await db.listHardware(cat.id)).toEqual([]);
  });

  it('goes when its component goes', async () => {
    const [cat] = await db.listCategories();
    await db.upsertHardware({ categoryId: cat.id, name: 'X', notes: '' });
    await db.deleteCategory(cat.id);
    expect(await db.listHardware(cat.id)).toEqual([]);
  });

  it('travels with an exported component and is added (never duplicated) on import', async () => {
    const { parseLibraryFile, serializeLibrary } = await import('../io/libraryFormat');
    const [cat] = await db.listCategories();
    await db.upsertHardware({ categoryId: cat.id, name: 'Burkert 2076', notes: 'Viton seals' });
    const text = serializeLibrary(await db.collectExportable([cat.id]));
    expect(parseLibraryFile(text).components[0].hardware).toEqual([{ name: 'Burkert 2076', notes: 'Viton seals' }]);

    // Importing the same component again adds nothing...
    expect(await db.importLibrary(parseLibraryFile(text))).toMatchObject({ hardware: 0, skipped: 1 });
    // ...but a colleague's extra hardware for a component you already have is added to it.
    const theirs = parseLibraryFile(text);
    theirs.components[0].hardware.push({ name: 'Parker 9', notes: 'EPDM' });
    expect(await db.importLibrary(theirs)).toMatchObject({ hardware: 1 });
    expect((await db.listHardware(cat.id)).map((h) => h.name)).toEqual(['Burkert 2076', 'Parker 9']);
  });
});
