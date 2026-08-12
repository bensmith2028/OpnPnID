/**
 * Hand-built vector symbols for the seeded valve categories, drawn from
 * `reference/basicSymbols.jpg` (ISA-style bow-tie valve bodies + actuator glyphs),
 * plus the generic N-port placeholder used as a fallback for categories that don't
 * have a specific symbol yet (Pump, Instrument, Fitting, Gas Inlet, and any new valve
 * subtype/actuation combination added later). Both kinds are just values of the same
 * `SymbolGeometry` type — `resolveSymbol` is the only thing callers need.
 *
 * All coordinates are local/unscaled, roughly ±14 units (matching the old placeholder's
 * size) so built-in and placeholder symbols read at a consistent scale on the canvas.
 */
import type { SymbolGeometry, Vec2 } from '../types/geometry';

const HALF_EXTENT = 14;

/** Mutable builder — a plain object matching `SymbolGeometry`'s shape, built up point by
 * point/line by line, then used directly (it already satisfies the type). */
function newSymbol(): SymbolGeometry {
  return { points: {}, lines: [], arcs: [], ports: [] };
}

function pt(s: SymbolGeometry, id: string, x: number, y: number) {
  s.points[id] = { x, y };
}

function ln(s: SymbolGeometry, a: string, b: string) {
  s.lines.push([a, b]);
}

/**
 * Adds one triangular "arm" of a valve bow-tie: a hollow triangle with its apex at
 * `apexId` (must already exist) and its base perpendicular to the arm direction,
 * split at the midpoint so that midpoint can be a real connection point — pipes attach
 * exactly where they visually meet the symbol, not by convention. `dir` is the unit
 * vector pointing outward from the apex along the arm.
 */
function addBowtieArm(s: SymbolGeometry, apexId: string, dir: Vec2, armLen: number, baseHalf: number, stubLen: number, prefix: string) {
  const perp: Vec2 = { x: -dir.y, y: dir.x };
  const baseX = dir.x * armLen;
  const baseY = dir.y * armLen;
  const topId = `${prefix}Top`;
  const midId = `${prefix}Mid`;
  const botId = `${prefix}Bot`;
  const portId = `${prefix}Port`;
  pt(s, topId, baseX + perp.x * baseHalf, baseY + perp.y * baseHalf);
  pt(s, midId, baseX, baseY);
  pt(s, botId, baseX - perp.x * baseHalf, baseY - perp.y * baseHalf);
  ln(s, topId, midId);
  ln(s, midId, botId);
  ln(s, botId, apexId);
  ln(s, apexId, topId);
  pt(s, portId, dir.x * (armLen + stubLen), dir.y * (armLen + stubLen));
  ln(s, midId, portId);
  s.ports.push(portId);
}

const LEFT: Vec2 = { x: -1, y: 0 };
const RIGHT: Vec2 = { x: 1, y: 0 };
const DOWN: Vec2 = { x: 0, y: 1 }; // y-down screen convention — "down" visually

function bowtie2Way(): SymbolGeometry {
  const s = newSymbol();
  pt(s, 'center', 0, 0);
  addBowtieArm(s, 'center', LEFT, 8, 6, 6, 'l');
  addBowtieArm(s, 'center', RIGHT, 8, 6, 6, 'r');
  return s;
}

function bowtie3Way(): SymbolGeometry {
  const s = bowtie2Way();
  addBowtieArm(s, 'center', DOWN, 8, 6, 6, 'b');
  return s;
}

/** Manual actuation: a stem to a T-bar (top-down handwheel view). */
function withManualStem(s: SymbolGeometry): SymbolGeometry {
  pt(s, 'stemTop', 0, -14);
  ln(s, 'center', 'stemTop');
  pt(s, 'wheelL', -5, -14);
  pt(s, 'wheelR', 5, -14);
  ln(s, 'wheelL', 'wheelR');
  return s;
}

/** Generic automated actuation: a stem to a small actuator box — the user asked for
 * "automated" generically (not motor/solenoid/pneumatic specifically), so this reads as
 * "there's an actuator here" without over-committing to a particular type. */
function withAutomatedStem(s: SymbolGeometry): SymbolGeometry {
  pt(s, 'stemTop', 0, -14);
  ln(s, 'center', 'stemTop');
  pt(s, 'boxBL', -5, -14);
  pt(s, 'boxBR', 5, -14);
  pt(s, 'boxTR', 5, -21);
  pt(s, 'boxTL', -5, -21);
  ln(s, 'boxBL', 'boxBR');
  ln(s, 'boxBR', 'boxTR');
  ln(s, 'boxTR', 'boxTL');
  ln(s, 'boxTL', 'boxBL');
  return s;
}

/** Needle valve: the 2-way bow-tie + a small diamond at the body center (the tapered
 * needle element, per the research report's symbol grammar) + a handwheel stem. */
function needleValveSymbol(): SymbolGeometry {
  const s = bowtie2Way();
  pt(s, 'dTop', 0, -6);
  pt(s, 'dLeft', -3, -3);
  pt(s, 'dRight', 3, -3);
  ln(s, 'center', 'dLeft');
  ln(s, 'dLeft', 'dTop');
  ln(s, 'dTop', 'dRight');
  ln(s, 'dRight', 'center');
  pt(s, 'stemTop', 0, -14);
  ln(s, 'dTop', 'stemTop');
  pt(s, 'wheelL', -5, -14);
  pt(s, 'wheelR', 5, -14);
  ln(s, 'wheelL', 'wheelR');
  return s;
}

/** Check valve: an arrowhead pointing in the flow direction, seated against a
 * perpendicular seat bar — the universal check-valve glyph. No actuator (self-acting). */
function checkValveSymbol(): SymbolGeometry {
  const s = newSymbol();
  pt(s, 'portL', -14, 0);
  pt(s, 'baseTop', -6, -6);
  pt(s, 'baseMid', -6, 0);
  pt(s, 'baseBot', -6, 6);
  pt(s, 'tip', 6, 0);
  pt(s, 'seatTop', 6, -7);
  pt(s, 'seatBot', 6, 7);
  pt(s, 'portR', 14, 0);
  ln(s, 'portL', 'baseMid');
  ln(s, 'baseTop', 'baseMid');
  ln(s, 'baseMid', 'baseBot');
  ln(s, 'baseTop', 'tip');
  ln(s, 'baseBot', 'tip');
  ln(s, 'seatTop', 'tip');
  ln(s, 'tip', 'seatBot');
  ln(s, 'tip', 'portR');
  s.ports.push('portL', 'portR');
  return s;
}

/** Keyed by `${subtype}|${actuation ?? ''}` — matches the seeded valve categories. */
const VALVE_SYMBOLS: Record<string, SymbolGeometry> = {
  '2-way|manual': withManualStem(bowtie2Way()),
  '2-way|automated': withAutomatedStem(bowtie2Way()),
  '3-way|manual': withManualStem(bowtie3Way()),
  '3-way|automated': withAutomatedStem(bowtie3Way()),
  'check|': checkValveSymbol(),
  'needle|manual': needleValveSymbol(),
};

function placeholderPortLayout(portCount: number): Vec2[] {
  if (portCount <= 1) return [{ x: 0, y: 12 }];
  if (portCount === 2)
    return [
      { x: -12, y: 0 },
      { x: 12, y: 0 },
    ];
  if (portCount === 3)
    return [
      { x: -12, y: 0 },
      { x: 12, y: 0 },
      { x: 0, y: -12 },
    ];
  if (portCount === 4)
    return [
      { x: -12, y: 0 },
      { x: 12, y: 0 },
      { x: 0, y: -12 },
      { x: 0, y: 12 },
    ];
  return Array.from({ length: portCount }, (_, i) => {
    const angle = (i / portCount) * Math.PI * 2;
    return { x: Math.cos(angle) * HALF_EXTENT, y: Math.sin(angle) * HALF_EXTENT };
  });
}

/** Generic fallback: a square outline with `portCount` ports laid out inside it (same
 * look the app had before real symbols existed) — used for any category that doesn't
 * have a hand-built symbol yet. */
export function generatePlaceholderSymbol(portCount: number): SymbolGeometry {
  const s = newSymbol();
  pt(s, 'tl', -HALF_EXTENT, -HALF_EXTENT);
  pt(s, 'tr', HALF_EXTENT, -HALF_EXTENT);
  pt(s, 'br', HALF_EXTENT, HALF_EXTENT);
  pt(s, 'bl', -HALF_EXTENT, HALF_EXTENT);
  ln(s, 'tl', 'tr');
  ln(s, 'tr', 'br');
  ln(s, 'br', 'bl');
  ln(s, 'bl', 'tl');
  placeholderPortLayout(portCount).forEach((p, i) => {
    const id = `port${i}`;
    s.points[id] = p;
    s.ports.push(id);
  });
  return s;
}

/** Resolves a category's symbol: a hand-built one if `subtype`+`actuation` match a
 * known valve glyph, otherwise the generic `portCount`-port placeholder. This is the
 * only lookup callers need — hand-built and placeholder symbols are indistinguishable
 * by type, so nothing downstream (SceneGraph, the renderer) needs to know which it got. */
export function resolveSymbol(subtype: string | null, actuation: string | null, portCount: number): SymbolGeometry {
  const key = `${subtype ?? ''}|${actuation ?? ''}`;
  return VALVE_SYMBOLS[key] ?? generatePlaceholderSymbol(portCount);
}

/** Local axis-aligned bounding box of a symbol's points — used by the renderer/select
 * tool instead of a fixed placeholder half-extent now that symbols vary in size/shape. */
export function symbolLocalBounds(symbol: SymbolGeometry): { minX: number; maxX: number; minY: number; maxY: number } {
  const points = Object.values(symbol.points);
  if (points.length === 0) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, maxX, minY, maxY };
}

/** Max distance from the symbol's origin to any of its points — used to place the
 * component tag clear of the symbol regardless of its shape. */
export function symbolBoundingRadius(symbol: SymbolGeometry): number {
  let max = 0;
  for (const p of Object.values(symbol.points)) {
    const d = Math.hypot(p.x, p.y);
    if (d > max) max = d;
  }
  return max;
}
