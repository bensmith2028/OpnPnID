import { useEffect, useState } from 'react';
import { DEFAULT_LINE_WEIGHT, MAX_LINE_WEIGHT, MIN_LINE_WEIGHT } from '../types/geometry';

/** "Line weight" control shared by the main window's Properties panel and the symbol editor's:
 * a number, in pixels.
 *
 * `value` is the weight of what's selected — a number, `undefined` for "the default", or
 * `'mixed'` when the selection has several different weights. `onChange(null)` means "back to
 * the default". */
export function WeightField({ value, onChange }: { value: number | undefined | 'mixed'; onChange: (weight: number | null) => void }) {
  const shown = value === 'mixed' ? '' : String(value ?? DEFAULT_LINE_WEIGHT);
  const [text, setText] = useState(shown);

  // Follow the selection: a different item (or an undo) changes what the box should say.
  useEffect(() => setText(shown), [shown]);

  const commit = () => {
    const n = parseFloat(text);
    if (!Number.isFinite(n)) {
      setText(shown);
      return;
    }
    const clamped = Math.min(MAX_LINE_WEIGHT, Math.max(MIN_LINE_WEIGHT, n));
    onChange(clamped === DEFAULT_LINE_WEIGHT ? null : clamped);
    setText(String(clamped));
  };

  return (
    <div className="field">
      <span>Line weight</span>
      <div className="weight-row">
        <input
          type="number"
          step="0.5"
          min={MIN_LINE_WEIGHT}
          max={MAX_LINE_WEIGHT}
          value={text}
          placeholder={value === 'mixed' ? 'mixed' : undefined}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          title={`Stroke thickness in pixels (${MIN_LINE_WEIGHT}–${MAX_LINE_WEIGHT}; normal is ${DEFAULT_LINE_WEIGHT})`}
        />
      </div>
    </div>
  );
}

/** The common weight of some items, `'mixed'` if they differ, or `undefined` for the default. */
export function commonWeight(weights: (number | undefined)[]): number | undefined | 'mixed' {
  if (weights.length === 0) return undefined;
  return weights.every((w) => w === weights[0]) ? weights[0] : 'mixed';
}
