import { describe, expect, it } from 'vitest';
import type { ComponentInstance, SymbolGeometry } from '../types/geometry';
import { buildDetailedRows, buildSummaryRows, detailedRowsToCsv, summaryRowsToCsv } from './bomExport';

const EMPTY_SYMBOL: SymbolGeometry = { points: {}, lines: [], arcs: [], ports: [] };

/** Minimal valid instance, overridable per test — position/rotation/connections don't
 * matter to BOM building, only `tag`, `name` and `snapshot`. `name` is left off here so
 * the default instance is an unnamed one (the state every component starts in). */
function makeInstance(overrides: Partial<ComponentInstance> & { id: string }): ComponentInstance {
  return {
    categoryId: 'cat',
    realPartId: null,
    tag: 'T-1',
    position: { x: 0, y: 0 },
    rotation: 0,
    connections: [],
    snapshot: {
      familyName: 'Valves',
      categoryName: '2-Way Ball Valve',
      symbol: EMPTY_SYMBOL,
      realPart: null,
    },
    ...overrides,
  };
}

describe('buildDetailedRows', () => {
  it('emits one row per instance with real-part fields populated', () => {
    const instance = makeInstance({
      id: 'c1',
      tag: 'V-101',
      name: 'Reactor feed isolation',
      snapshot: {
        familyName: 'Valves',
        categoryName: '2-Way Ball Valve',
        symbol: EMPTY_SYMBOL,
        realPart: {
          manufacturer: 'Swagelok',
          modelNumber: 'SS-83XS6',
          datasheetUrl: 'https://example.com/ds.pdf',
          specs: { cv: 2.5, fail_position: 'FC' },
        },
      },
    });
    const rows = buildDetailedRows([instance]);
    expect(rows).toEqual([
      {
        tag: 'V-101',
        name: 'Reactor feed isolation',
        family: 'Valves',
        category: '2-Way Ball Valve',
        manufacturer: 'Swagelok',
        modelNumber: 'SS-83XS6',
        specs: 'cv=2.5; fail_position=FC',
        datasheetUrl: 'https://example.com/ds.pdf',
      },
    ]);
  });

  it('leaves manufacturer/model/specs/datasheet blank for an instance with no real part, but still includes the row', () => {
    const instance = makeInstance({ id: 'c1', tag: 'V-102', name: 'Vent' });
    const rows = buildDetailedRows([instance]);
    expect(rows).toEqual([
      {
        tag: 'V-102',
        name: 'Vent',
        family: 'Valves',
        category: '2-Way Ball Valve',
        manufacturer: '',
        modelNumber: '',
        specs: '',
        datasheetUrl: '',
      },
    ]);
  });

  it('leaves the name blank for an instance the user never named', () => {
    const rows = buildDetailedRows([makeInstance({ id: 'c1', tag: 'V-103' })]);
    expect(rows[0].name).toBe('');
  });

  it('preserves instance order and count (no grouping)', () => {
    const a = makeInstance({ id: 'c1', tag: 'V-1' });
    const b = makeInstance({ id: 'c2', tag: 'V-2' });
    expect(buildDetailedRows([a, b]).map((r) => r.tag)).toEqual(['V-1', 'V-2']);
  });
});

describe('buildSummaryRows', () => {
  it('groups instances sharing (category, manufacturer, model) into one row with a quantity count', () => {
    const partSnapshot = {
      familyName: 'Valves',
      categoryName: '2-Way Ball Valve',
      symbol: EMPTY_SYMBOL,
      realPart: { manufacturer: 'Swagelok', modelNumber: 'SS-83XS6', specs: { cv: 2.5 } },
    };
    const a = makeInstance({ id: 'c1', tag: 'V-1', snapshot: partSnapshot });
    const b = makeInstance({ id: 'c2', tag: 'V-2', snapshot: partSnapshot });
    const c = makeInstance({ id: 'c3', tag: 'V-3', snapshot: partSnapshot });

    const rows = buildSummaryRows([a, b, c]);
    expect(rows).toEqual([
      {
        family: 'Valves',
        category: '2-Way Ball Valve',
        manufacturer: 'Swagelok',
        modelNumber: 'SS-83XS6',
        quantity: 3,
        specs: 'cv=2.5',
        datasheetUrl: '',
      },
    ]);
  });

  it('keeps different (category, manufacturer, model) combinations as separate rows', () => {
    const a = makeInstance({
      id: 'c1',
      snapshot: {
        familyName: 'Valves',
        categoryName: '2-Way Ball Valve',
        symbol: EMPTY_SYMBOL,
        realPart: { manufacturer: 'Swagelok', modelNumber: 'SS-83XS6', specs: {} },
      },
    });
    const b = makeInstance({
      id: 'c2',
      snapshot: {
        familyName: 'Valves',
        categoryName: '2-Way Ball Valve',
        symbol: EMPTY_SYMBOL,
        realPart: { manufacturer: 'Parker', modelNumber: '4A-B4', specs: {} },
      },
    });
    const rows = buildSummaryRows([a, b]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.quantity)).toEqual([1, 1]);
  });

  it('groups instances with no real part assigned by category alone, separate from any assigned-part group in that category', () => {
    const unassigned1 = makeInstance({ id: 'c1' });
    const unassigned2 = makeInstance({ id: 'c2' });
    const assigned = makeInstance({
      id: 'c3',
      snapshot: {
        familyName: 'Valves',
        categoryName: '2-Way Ball Valve',
        symbol: EMPTY_SYMBOL,
        realPart: { manufacturer: 'Swagelok', modelNumber: 'SS-83XS6', specs: {} },
      },
    });

    const rows = buildSummaryRows([unassigned1, unassigned2, assigned]);
    expect(rows).toHaveLength(2);
    const unassignedRow = rows.find((r) => r.manufacturer === '');
    const assignedRow = rows.find((r) => r.manufacturer === 'Swagelok');
    expect(unassignedRow).toMatchObject({ category: '2-Way Ball Valve', manufacturer: '', modelNumber: '', quantity: 2 });
    expect(assignedRow).toMatchObject({ modelNumber: 'SS-83XS6', quantity: 1 });
  });
});

describe('detailedRowsToCsv / summaryRowsToCsv', () => {
  it('renders a detailed header row plus one line per row, quoting fields that need it', () => {
    const instance = makeInstance({
      id: 'c1',
      tag: 'V-1',
      name: 'Feed, main',
      snapshot: {
        familyName: 'Valves',
        categoryName: 'Ball Valve, 2-Way',
        symbol: EMPTY_SYMBOL,
        realPart: { manufacturer: 'Acme, Inc.', modelNumber: 'X1', specs: { note: 'says "hi"' } },
      },
    });
    const csv = detailedRowsToCsv(buildDetailedRows([instance]));
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('Tag,Name,Family,Category,Manufacturer,Model Number,Specs,Datasheet URL');
    expect(lines[1]).toBe('V-1,"Feed, main",Valves,"Ball Valve, 2-Way","Acme, Inc.",X1,"note=says ""hi""",');
  });

  it('renders a summary header row plus one line per group', () => {
    const csv = summaryRowsToCsv([
      { family: 'Valves', category: '2-Way Ball Valve', manufacturer: 'Swagelok', modelNumber: 'SS-83XS6', quantity: 3, specs: 'cv=2.5', datasheetUrl: '' },
    ]);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('Family,Category,Manufacturer,Model Number,Quantity,Specs,Datasheet URL');
    expect(lines[1]).toBe('Valves,2-Way Ball Valve,Swagelok,SS-83XS6,3,cv=2.5,');
  });
});
