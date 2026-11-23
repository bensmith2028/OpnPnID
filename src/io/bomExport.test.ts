import { describe, expect, it } from 'vitest';
import type { ComponentInstance, SymbolGeometry } from '../types/geometry';
import { buildDetailedRows, buildSummaryRows, detailedRowsToCsv, rowToCsvLine, summaryRowsToCsv } from './bomExport';

const EMPTY_SYMBOL: SymbolGeometry = { points: {}, lines: [], arcs: [], ports: [] };

/** Minimal valid instance, overridable per test — position/rotation/connections don't
 * matter to BOM building, only `tag`, `name` and `snapshot`. */
function makeInstance(overrides: Partial<ComponentInstance> & { id: string }, categoryName = 'Check Valve', familyName = 'Valve'): ComponentInstance {
  return {
    categoryId: 'cat',
    tag: 'T-1',
    position: { x: 0, y: 0 },
    rotation: 0,
    connections: [],
    snapshot: { familyName, categoryName, symbol: EMPTY_SYMBOL },
    ...overrides,
  };
}

describe('buildDetailedRows', () => {
  it('emits one row per instance', () => {
    const rows = buildDetailedRows([
      makeInstance({ id: 'c1', tag: 'V-101', name: 'Reactor feed isolation' }),
      makeInstance({ id: 'c2', tag: 'V-102' }),
    ]);
    expect(rows).toEqual([
      { tag: 'V-101', name: 'Reactor feed isolation', family: 'Valve', category: 'Check Valve' },
      { tag: 'V-102', name: '', family: 'Valve', category: 'Check Valve' },
    ]);
  });
});

describe('buildSummaryRows', () => {
  it('groups instances of the same component into one row with a quantity', () => {
    const rows = buildSummaryRows([
      makeInstance({ id: 'c1' }),
      makeInstance({ id: 'c2' }),
      makeInstance({ id: 'c3' }, 'Needle Valve'),
      makeInstance({ id: 'c4' }, 'Vacuum Pump', 'Pump'),
    ]);
    expect(rows).toEqual([
      { family: 'Valve', category: 'Check Valve', quantity: 2 },
      { family: 'Valve', category: 'Needle Valve', quantity: 1 },
      { family: 'Pump', category: 'Vacuum Pump', quantity: 1 },
    ]);
  });

  it('keeps same-named components in different families apart', () => {
    const rows = buildSummaryRows([makeInstance({ id: 'c1' }, 'Generic', 'A'), makeInstance({ id: 'c2' }, 'Generic', 'B')]);
    expect(rows).toHaveLength(2);
  });
});

describe('CSV output', () => {
  it('writes a header and one line per row', () => {
    const csv = detailedRowsToCsv(buildDetailedRows([makeInstance({ id: 'c1', tag: 'V-1', name: 'Feed' })]));
    expect(csv).toBe('Tag,Name,Family,Component\nV-1,Feed,Valve,Check Valve\n');
    expect(summaryRowsToCsv(buildSummaryRows([makeInstance({ id: 'c1' })]))).toBe('Family,Component,Quantity\nValve,Check Valve,1\n');
  });

  it('quotes fields containing commas, quotes or newlines', () => {
    expect(rowToCsvLine(['a,b', 'say "hi"', 'two\nlines', 3, null])).toBe('"a,b","say ""hi""","two\nlines",3,');
  });
});
