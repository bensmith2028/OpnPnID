import { describe, expect, it } from 'vitest';
import { suggestTag, suggestTagLetter } from './tagging';

describe('suggestTagLetter', () => {
  it('uses the category tag letter when set', () => {
    expect(suggestTagLetter({ tagLetter: 'V' }, { subtype: 'ball' })).toBe('V');
  });

  it('falls back to a measured-variable lookup when the category has no fixed letter', () => {
    expect(suggestTagLetter({ tagLetter: null }, { subtype: 'Pressure' })).toBe('P');
    expect(suggestTagLetter({ tagLetter: null }, { subtype: 'flow' })).toBe('F');
  });

  it('falls back to X when neither is available', () => {
    expect(suggestTagLetter({ tagLetter: null }, { subtype: null })).toBe('X');
    expect(suggestTagLetter({ tagLetter: null }, { subtype: 'unknown-thing' })).toBe('X');
  });
});

describe('suggestTag', () => {
  it('starts at 101 when there are no existing tags', () => {
    expect(suggestTag([], 'V')).toBe('V-101');
  });

  it('skips loop numbers already in use for that letter', () => {
    expect(suggestTag(['V-101', 'V-102'], 'V')).toBe('V-103');
  });

  it('fills a gap rather than always appending at the end', () => {
    expect(suggestTag(['V-101', 'V-103'], 'V')).toBe('V-102');
  });

  it('ignores tags for a different letter', () => {
    expect(suggestTag(['P-101', 'P-102'], 'V')).toBe('V-101');
  });

  it('is case-insensitive on the letter prefix', () => {
    expect(suggestTag(['v-101'], 'V')).toBe('V-102');
  });
});
