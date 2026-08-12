/** ISA-lite tag auto-suggestion. Deliberately not the full ISA-5.1 first+succeeding
 * letter composition (Section 3 of the research report) — this picks a single letter
 * (the family's configured `tagLetter`, or the category's measured-variable subtype for
 * instruments) and an auto-incrementing loop number, always user-editable afterward in
 * the Properties Panel. Good enough to be useful without over-building a feature the
 * user will mostly just retype anyway. */

const VARIABLE_TO_LETTER: Record<string, string> = {
  pressure: 'P',
  temperature: 'T',
  flow: 'F',
  level: 'L',
  analytical: 'A',
  speed: 'S',
  position: 'Z',
  weight: 'W',
  multivariable: 'U',
};

/** Picks the tag letter for a newly placed instance: the family's own `tagLetter` if
 * set (e.g. Valve -> 'V'), else a measured-variable lookup for instrument-like categories
 * (subtype = "Pressure", "Flow", ...), else a generic fallback. */
export function suggestTagLetter(family: { tagLetter: string | null }, category: { subtype: string | null }): string {
  if (family.tagLetter) return family.tagLetter;
  const key = category.subtype?.toLowerCase().trim() ?? '';
  return VARIABLE_TO_LETTER[key] ?? 'X';
}

/** Suggests "<letter>-<loop>" (e.g. "FV-101"), scanning existing tags for the lowest
 * unused loop number starting at 101 (a common ISA convention for a unit's first loop). */
export function suggestTag(existingTags: Iterable<string>, letter: string): string {
  const used = new Set<number>();
  const pattern = new RegExp(`^${letter}-(\\d+)`, 'i');
  for (const tag of existingTags) {
    const m = pattern.exec(tag);
    if (m) used.add(parseInt(m[1], 10));
  }
  let n = 101;
  while (used.has(n)) n += 1;
  return `${letter}-${n}`;
}
