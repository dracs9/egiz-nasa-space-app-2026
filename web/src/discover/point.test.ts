import { describe, expect, it } from 'vitest';
import { alignShard } from './PointPicker';
import type { ScoreShard } from './types';

const shard: ScoreShard = { schema: 'egiz.discovery_scores', version: 'point-1.0.0', target: 'PT', dims: ['a'],
  status_codes: ['measured', 'missing', 'not_assessed', 'not_applicable'], s50: [[0.1, 0.2]], lo: [[0, 0.1]], hi: [[0.2, 0.3]],
  status: [[0, 0]], w1_deg: [1, 2] };

describe('alignShard', () => {
  it('keeps identical order untouched', () => { expect(alignShard(shard, ['x', 'y'], ['x', 'y'])).toBe(shard); });
  it('reorders by id and marks unknown windows missing', () => {
    const out = alignShard(shard, ['x', 'y'], ['y', 'z', 'x']);
    expect(out.s50[0]).toEqual([0.2, null, 0.1]);
    expect(out.status[0]).toEqual([0, 1, 0]);
    expect(out.w1_deg).toEqual([2, null, 1]);
  });
});
