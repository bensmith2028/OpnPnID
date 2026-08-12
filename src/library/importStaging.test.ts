import { describe, expect, it } from 'vitest';
import { bestCategoryMatch, scoreCategoryMatch } from './importStaging';

describe('scoreCategoryMatch', () => {
  it('scores 0 when the family does not match at all, regardless of everything else matching', () => {
    const score = scoreCategoryMatch(
      { family: 'Pump', subtype: '2-way', actuation: 'manual', portCount: 2 },
      { familyName: 'Valve', subtype: '2-way', actuation: 'manual', portCount: 2 },
    );
    expect(score).toBe(0);
  });

  it('scores higher the more dimensions agree, given a matching family', () => {
    const familyOnly = scoreCategoryMatch({ family: 'Valve' }, { familyName: 'Valve', subtype: '3-way', actuation: 'automated', portCount: 3 });
    const plusSubtype = scoreCategoryMatch(
      { family: 'Valve', subtype: '2-way' },
      { familyName: 'Valve', subtype: '2-way', actuation: 'automated', portCount: 3 },
    );
    const allFour = scoreCategoryMatch(
      { family: 'Valve', subtype: '2-way', actuation: 'manual', portCount: 2 },
      { familyName: 'Valve', subtype: '2-way', actuation: 'manual', portCount: 2 },
    );
    expect(plusSubtype).toBeGreaterThan(familyOnly);
    expect(allFour).toBeGreaterThan(plusSubtype);
  });

  it('is case-insensitive and trims whitespace, since extracted text is rarely normalized', () => {
    const score = scoreCategoryMatch(
      { family: '  VALVE ', subtype: 'Manual ' },
      { familyName: 'valve', subtype: ' manual', actuation: null, portCount: 2 },
    );
    expect(score).toBe(3); // family (1) + subtype (2)
  });
});

describe('bestCategoryMatch', () => {
  it('picks the highest-scoring category among several candidates', () => {
    const categories = [
      { id: 'a', familyName: 'Valve', subtype: '3-way', actuation: 'manual', portCount: 3 },
      { id: 'b', familyName: 'Valve', subtype: '2-way', actuation: 'automated', portCount: 2 },
      { id: 'c', familyName: 'Pump', subtype: null, actuation: null, portCount: 2 },
    ];
    const best = bestCategoryMatch({ family: 'Valve', subtype: '2-way', actuation: 'automated', portCount: 2 }, categories);
    expect(best?.id).toBe('b');
  });

  it('returns null when nothing shares the hinted family', () => {
    const categories = [{ id: 'a', familyName: 'Pump', subtype: null, actuation: null, portCount: 1 }];
    const best = bestCategoryMatch({ family: 'Instrument' }, categories);
    expect(best).toBeNull();
  });
});
