import { describe, expect, it } from 'vitest';
import { normalizeTagLetter } from './FamilyManager';

/** The one piece of pure logic behind the family rows' tag-letter field: it's typed into
 * both the Add Family form and the inline per-row box, and whatever comes back is written
 * straight to families.tag_letter (nullable), so the coercion has to be identical and
 * total for both. */
describe('normalizeTagLetter', () => {
  it('keeps a single letter, uppercased', () => {
    expect(normalizeTagLetter('v')).toBe('V');
    expect(normalizeTagLetter('P')).toBe('P');
  });

  it('keeps only the first character of a longer entry', () => {
    expect(normalizeTagLetter('valve')).toBe('V');
  });

  it('maps blank and whitespace-only entries to null (no default letter for this family)', () => {
    expect(normalizeTagLetter('')).toBeNull();
    expect(normalizeTagLetter('   ')).toBeNull();
  });

  it('trims surrounding whitespace rather than taking it as the letter', () => {
    expect(normalizeTagLetter(' v ')).toBe('V');
  });

  it('is idempotent — re-normalizing a stored value is a no-op', () => {
    const once = normalizeTagLetter('valve');
    expect(normalizeTagLetter(once ?? '')).toBe(once);
  });
});
