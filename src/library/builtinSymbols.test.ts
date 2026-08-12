import { describe, expect, it } from 'vitest';
import type { SymbolGeometry } from '../types/geometry';
import { generatePlaceholderSymbol, resolveSymbol } from './builtinSymbols';

/** Every line and port must reference a point that actually exists — the kind of typo
 * that's easy to make hand-writing coordinates and invisible until it crashes the
 * renderer, so it's worth asserting structurally rather than only eyeballing it. */
function expectStructurallyValid(symbol: SymbolGeometry) {
  const pointIds = new Set(Object.keys(symbol.points));
  for (const [a, b] of symbol.lines) {
    expect(pointIds.has(a), `line references missing point "${a}"`).toBe(true);
    expect(pointIds.has(b), `line references missing point "${b}"`).toBe(true);
  }
  for (const arc of symbol.arcs) {
    expect(pointIds.has(arc.a), `arc references missing point "${arc.a}"`).toBe(true);
    expect(pointIds.has(arc.b), `arc references missing point "${arc.b}"`).toBe(true);
  }
  for (const portId of symbol.ports) {
    expect(pointIds.has(portId), `port references missing point "${portId}"`).toBe(true);
  }
  expect(new Set(symbol.ports).size).toBe(symbol.ports.length); // no duplicate ports
}

describe('resolveSymbol', () => {
  const valveCases: { subtype: string; actuation: string | null; expectedPorts: number }[] = [
    { subtype: '2-way', actuation: 'manual', expectedPorts: 2 },
    { subtype: '2-way', actuation: 'automated', expectedPorts: 2 },
    { subtype: '3-way', actuation: 'manual', expectedPorts: 3 },
    { subtype: '3-way', actuation: 'automated', expectedPorts: 3 },
    { subtype: 'check', actuation: null, expectedPorts: 2 },
    { subtype: 'needle', actuation: 'manual', expectedPorts: 2 },
  ];

  it.each(valveCases)('resolves a distinct, structurally valid symbol for $subtype/$actuation', ({ subtype, actuation, expectedPorts }) => {
    const symbol = resolveSymbol(subtype, actuation, 2);
    expect(symbol.ports).toHaveLength(expectedPorts);
    expectStructurallyValid(symbol);
  });

  it('gives every valve category a genuinely distinct symbol (not all the same placeholder)', () => {
    const symbols = valveCases.map((c) => resolveSymbol(c.subtype, c.actuation, 2));
    const serialized = symbols.map((s) => JSON.stringify({ points: s.points, lines: s.lines }));
    expect(new Set(serialized).size).toBe(symbols.length);
  });

  it('falls back to the generic placeholder for an unknown subtype/actuation combination', () => {
    const symbol = resolveSymbol('butterfly', 'pneumatic', 2);
    const placeholder = generatePlaceholderSymbol(2);
    expect(symbol).toEqual(placeholder);
  });

  it('falls back to the placeholder for a null subtype (e.g. an as-yet-undefined category)', () => {
    const symbol = resolveSymbol(null, null, 4);
    expect(symbol.ports).toHaveLength(4);
    expectStructurallyValid(symbol);
  });

  it('stays within the symbol editor\'s visible ±25-unit safety margin (regression: the automated-actuator box used to reach y=-21 against an editor view that only showed ±20)', () => {
    for (const { subtype, actuation } of valveCases) {
      const symbol = resolveSymbol(subtype, actuation, 2);
      for (const p of Object.values(symbol.points)) {
        expect(Math.abs(p.x), `${subtype}/${actuation} point x=${p.x}`).toBeLessThanOrEqual(25);
        expect(Math.abs(p.y), `${subtype}/${actuation} point y=${p.y}`).toBeLessThanOrEqual(25);
      }
    }
  });
});

describe('generatePlaceholderSymbol', () => {
  it('produces exactly portCount ports for a range of counts, all structurally valid', () => {
    for (const portCount of [1, 2, 3, 4, 5, 6]) {
      const symbol = generatePlaceholderSymbol(portCount);
      expect(symbol.ports).toHaveLength(portCount);
      expectStructurallyValid(symbol);
    }
  });

  it('always includes a 4-sided body outline', () => {
    const symbol = generatePlaceholderSymbol(2);
    expect(symbol.lines.length).toBeGreaterThanOrEqual(4);
    expect(Object.keys(symbol.points)).toEqual(expect.arrayContaining(['tl', 'tr', 'br', 'bl']));
  });
});
