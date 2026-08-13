/** Where a placed component's tag/name labels sit, and how big they are — shared by the
 * renderer (which draws them) and the select tool (which hit-tests and drags them), so a
 * label is always grabbed exactly where it appears. */

import { symbolBoundingRadius } from '../library/builtinSymbols';
import type { ComponentInstance, Vec2 } from '../types/geometry';
import { textHalfExtent } from './geometry';

export type ComponentLabelKind = 'tag' | 'name';

/** Both labels a component can have, in the order they're drawn/hit-tested. */
export const COMPONENT_LABEL_KINDS: readonly ComponentLabelKind[] = ['tag', 'name'];

/** Labels are drawn at a fixed screen height rather than a world size (unlike a text
 * annotation, whose `fontSize` is in world units): a tag is an identifier you read at any
 * zoom, not part of the drawing. */
export const LABEL_FONT_PX = 11;

/** Gap between the symbol's bounding circle and the near edge of an auto-placed label. */
const LABEL_GAP_PX = 6;

export function componentLabelText(instance: ComponentInstance, kind: ComponentLabelKind): string {
  return (kind === 'tag' ? instance.tag : instance.name) ?? '';
}

export function componentLabelCustomOffset(instance: ComponentInstance, kind: ComponentLabelKind): Vec2 | undefined {
  return kind === 'tag' ? instance.tagOffset : instance.nameOffset;
}

export function hasCustomLabelOffset(instance: ComponentInstance): boolean {
  return Boolean(instance.tagOffset || instance.nameOffset);
}

/**
 * Offset from the instance's position to its label's *centre*, in world units.
 *
 * The automatic placement straddles the symbol — tag above, name below — so the two never
 * collide with each other or with the body whatever the symbol's size. It depends on
 * `zoom` because the pieces it's built from are screen quantities (the gap and the glyph
 * height are fixed pixels), converted to world units here so callers can work in one
 * space; a dragged label's stored offset is already in world units and is returned as-is.
 */
export function componentLabelOffset(
  instance: ComponentInstance,
  kind: ComponentLabelKind,
  componentScale: number,
  zoom: number,
): Vec2 {
  const custom = componentLabelCustomOffset(instance, kind);
  if (custom) return custom;
  const bodyRadiusPx = symbolBoundingRadius(instance.snapshot.symbol) * componentScale * zoom;
  const dy = (bodyRadiusPx + LABEL_GAP_PX + LABEL_FONT_PX / 2) / zoom;
  return { x: 0, y: kind === 'tag' ? -dy : dy };
}

/** World position of a label's centre. */
export function componentLabelAnchor(
  instance: ComponentInstance,
  kind: ComponentLabelKind,
  componentScale: number,
  zoom: number,
): Vec2 {
  const offset = componentLabelOffset(instance, kind, componentScale, zoom);
  return { x: instance.position.x + offset.x, y: instance.position.y + offset.y };
}

/** Half-width/half-height of a label's box in world units — the same estimate a text
 * annotation uses (see textHalfExtent), just converted out of the label's fixed pixel
 * size, so the box a label is grabbed by tracks the glyphs at every zoom. */
export function componentLabelHalfExtent(text: string, zoom: number): Vec2 {
  const half = textHalfExtent(text, LABEL_FONT_PX);
  return { x: half.x / zoom, y: half.y / zoom };
}
