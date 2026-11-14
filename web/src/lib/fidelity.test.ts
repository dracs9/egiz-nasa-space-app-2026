import { describe, expect, it } from 'vitest';
import golden from '../../../data/fixtures/golden/golden_fidelity.json';
import { attributeFidelity } from './fidelity';

describe('attribute fidelity', () => {
  it('matches all 200 Python golden values including nulls', () => {
    for (const c of golden.cases) {
      const actual = attributeFidelity(c.spec, c.x_e, c.x_t);
      if (c.expected === null) expect(actual).toBeNull(); else expect(actual).toBeCloseTo(c.expected, 13);
    }
  });
  it('rejects invalid tolerances and leaves nonpositive log inputs missing', () => {
    expect(() => attributeFidelity({ fn: 'match', params: { sigma: 0 } }, 1, 1)).toThrow();
    expect(attributeFidelity({ fn: 'logmatch', params: { sigma: .2 } }, 0, 1)).toBeNull();
    expect(attributeFidelity({ fn: 'match', params: { sigma: 1 } }, null, 1)).toBeNull();
  });
});
