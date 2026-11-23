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
      { tag: 'V-101', name: 'Reactor feed isolation', family: 'Valve', category: 'Check Valve', hardware: '', notes: '' },
      { tag: 'V-102', name: '', family: 'Valve', category: 'Check Valve', hardware: '', notes: '' },
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
      { family: 'Valve', category: 'Check Valve', hardware: '', notes: '', quantity: 2 },
      { family: 'Valve', category: 'Needle Valve', hardware: '', notes: '', quantity: 1 },
      { family: 'Pump', category: 'Vacuum Pump', hardware: '', notes: '', quantity: 1 },
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
    expect(csv).toBe('Tag,Name,Family,Component,Hardware,Notes\nV-1,Feed,Valve,Check Valve,,\n');
    expect(summaryRowsToCsv(buildSummaryRows([makeInstance({ id: 'c1' })]))).toBe('Family,Component,Hardware,Notes,Quantity\nValve,Check Valve,,,1\n');
  });

  it('quotes fields containing commas, quotes or newlines', () => {
    expect(rowToCsvLine(['a,b', 'say "hi"', 'two\nlines', 3, null])).toBe('"a,b","say ""hi""","two\nlines",3,');
  });
});

describe('hardware in the parts list', () => {
  const hw = (name: string, notes: string) => ({ hardware: { name, notes } });

  it('lists each component\'s hardware and notes', () => {
    const rows = buildDetailedRows([makeInstance({ id: 'c1', tag: 'V-1', ...hw('Burkert 2076', 'Viton seals') })]);
    expect(rows[0]).toMatchObject({ hardware: 'Burkert 2076', notes: 'Viton seals' });
    expect(detailedRowsToCsv(rows)).toContain('V-1,,Valve,Check Valve,Burkert 2076,Viton seals');
  });

  it('keeps components with different hardware or notes on separate summary lines', () => {
    const rows = buildSummaryRows([
      makeInstance({ id: 'a', ...hw('Burkert 2076', 'Viton') }),
      makeInstance({ id: 'b', ...hw('Burkert 2076', 'Viton') }),
      makeInstance({ id: 'c', ...hw('Burkert 2076', 'EPDM') }),
      makeInstance({ id: 'd' }),
    ]);
    expect(rows.map((r) => [r.hardware, r.notes, r.quantity])).toEqual([
      ['Burkert 2076', 'Viton', 2],
      ['Burkert 2076', 'EPDM', 1],
      ['', '', 1],
    ]);
  });
});
